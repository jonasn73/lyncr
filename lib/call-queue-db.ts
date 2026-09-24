// ============================================
// call_queue Neon helpers — Lines waiting list + Answer
// ============================================
// Requires scripts/129-call-queue.sql. Missing-table errors are swallowed so
// voice keeps working before the migration is run (queue UI just shows empty).

import { neon } from "@neondatabase/serverless"
import { busyMenuAnswerUnlockMs } from "@/lib/hold-queue-answer"
import { holdMaxWaitSecs, lyncrHoldQueueName } from "@/lib/hold-queue"
import { lyncrLog } from "@/lib/lyncr-env"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"
import { sanitizeIanaTimezone } from "@/lib/telemetry-timezone"

export type CallQueueStatus =
  | "waiting"
  | "holding"
  | "bridging"
  | "answered"
  | "left"
  | "timed_out"
  | "sms_left"

export type CallQueueRow = {
  id: string
  user_id: string
  call_control_id: string
  call_session_id: string | null
  call_log_id: string | null
  caller_e164: string | null
  business_line_e164: string | null
  queue_name: string
  status: CallQueueStatus
  position_hint: number | null
  enqueued_at: string
  answered_by_user_id: string | null
  answered_at: string | null
  left_at: string | null
  /** Answers captured while on hold (Phase 1: one intent question). Empty until 170 is applied. */
  collected: Record<string, unknown>
}

function getSql() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10
}

function isMissingCallQueueTable(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message || e || "").toLowerCase()
  return msg.includes("call_queue") && (msg.includes("does not exist") || msg.includes("undefined_table"))
}

function isMissingHoldMusicColumn(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message || e || "").toLowerCase()
  return msg.includes("hold_music_url")
}

function isMissingHoldTuningColumn(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message || e || "").toLowerCase()
  return msg.includes("hold_max_wait_secs") || msg.includes("hold_reprompt_secs")
}

function isMissingCollectedColumn(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message || e || "").toLowerCase()
  return msg.includes("collected") && (msg.includes("does not exist") || msg.includes("undefined_column"))
}

function mapRow(r: Record<string, unknown>): CallQueueRow {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    call_control_id: String(r.call_control_id),
    call_session_id: r.call_session_id != null ? String(r.call_session_id) : null,
    call_log_id: r.call_log_id != null ? String(r.call_log_id) : null,
    caller_e164: r.caller_e164 != null ? String(r.caller_e164) : null,
    business_line_e164: r.business_line_e164 != null ? String(r.business_line_e164) : null,
    queue_name: String(r.queue_name || ""),
    status: String(r.status || "waiting") as CallQueueStatus,
    position_hint: r.position_hint != null ? Number(r.position_hint) : null,
    enqueued_at: String(r.enqueued_at || ""),
    answered_by_user_id: r.answered_by_user_id != null ? String(r.answered_by_user_id) : null,
    answered_at: r.answered_at != null ? String(r.answered_at) : null,
    left_at: r.left_at != null ? String(r.left_at) : null,
    collected:
      r.collected && typeof r.collected === "object" ? (r.collected as Record<string, unknown>) : {},
  }
}

async function broadcastQueue(userId: string): Promise<void> {
  try {
    const waiting = await listWaitingCallQueue(userId)
    await publishOwnerEvent(userId, "hold-queue-updated", {
      count: waiting.length,
      callers: waiting.map((w) => ({
        id: w.id,
        callerE164: w.caller_e164,
        enqueuedAt: w.enqueued_at,
        businessLineE164: w.business_line_e164,
        collected: w.collected,
      })),
    })
  } catch (e) {
    console.warn(lyncrLog("hold-queue-broadcast-failed", { error: String(e) }))
  }
}

/** How many callers are actively waiting / holding for this account. */
export async function countWaitingCallQueue(userId: string): Promise<number> {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT count(*)::int AS n
      FROM call_queue
      WHERE user_id = ${userId}
        AND status IN ('waiting', 'holding', 'bridging')
    `
    return Number((rows[0] as { n?: number })?.n ?? 0)
  } catch (e) {
    if (isMissingCallQueueTable(e)) return 0
    throw e
  }
}

/**
 * Clear ghost Busy-menu / hold rows:
 * - call_log already completed/ended for this call_control_id
 * - holding/waiting older than max hold + buffer (never sit 21m)
 * Also promote holding → waiting after the Busy greeting unlock window
 * so Answer is available without waiting for gather.ended.
 */
async function sweepStaleCallQueueForUser(userId: string): Promise<void> {
  try {
    const sql = getSql()
    // Max hold + 90s buffer — anything older is a ghost or overdue.
    const staleSecs = holdMaxWaitSecs(null) + 90
    // Greeting window — then treat as answerable hold.
    const unlockSecs = Math.ceil(busyMenuAnswerUnlockMs() / 1000)

    // Ghosts: completed call_logs, or absurdly old live statuses.
    await sql`
      UPDATE call_queue cq
      SET
        status = 'left',
        left_at = COALESCE(cq.left_at, now()),
        updated_at = now()
      WHERE cq.user_id = ${userId}
        AND cq.status IN ('waiting', 'holding', 'bridging')
        AND (
          (
            cq.enqueued_at < now() - (${staleSecs}::text || ' seconds')::interval
            AND coalesce(cq.collected->>'booking_link_sent', 'false') <> 'true'
          )
          OR EXISTS (
            SELECT 1
            FROM call_logs cl
            WHERE (
              cl.provider_call_sid = cq.call_control_id
            )
              AND (
                cl.ended_at IS NOT NULL
                OR lower(COALESCE(cl.status, '')) IN (
                  'completed', 'busy', 'failed', 'no-answer', 'canceled', 'cancelled'
                )
              )
          )
        )
    `

    // Past Busy greeting → Answer-ready (even if gather.ended never fired).
    await sql`
      UPDATE call_queue
      SET status = 'waiting', updated_at = now()
      WHERE user_id = ${userId}
        AND status = 'holding'
        AND enqueued_at < now() - (${unlockSecs}::text || ' seconds')::interval
    `
  } catch (e) {
    if (isMissingCallQueueTable(e)) return
    console.warn(lyncrLog("call-queue-sweep-failed", { error: String(e) }))
  }
}

/** Waiting list for Lines UI (oldest first). */
export async function listWaitingCallQueue(userId: string): Promise<CallQueueRow[]> {
  try {
    // Drop ghosts + unlock Answer after Busy greeting before we read the list.
    await sweepStaleCallQueueForUser(userId)
    const sql = getSql()
    const rows = await sql`
      SELECT *
      FROM call_queue
      WHERE user_id = ${userId}
        AND status IN ('waiting', 'holding', 'bridging')
      ORDER BY enqueued_at ASC
      LIMIT 25
    `
    return (rows as Record<string, unknown>[]).map(mapRow)
  } catch (e) {
    if (isMissingCallQueueTable(e)) return []
    throw e
  }
}

/**
 * Soft preview while the Busy gather plays (before Telnyx enqueue).
 * Status `holding` shows on Lines as “In Busy menu” — Answer unlocks after
 * busyMenuAnswerUnlockMs() (or when promoted to `waiting` on stay-on-line).
 */
export async function upsertCallQueueBusyMenu(params: {
  userId: string
  callControlId: string
  callSessionId?: string | null
  callerE164?: string | null
  businessLineE164?: string | null
  callLogId?: string | null
}): Promise<CallQueueRow | null> {
  const queueName = lyncrHoldQueueName(params.userId)
  try {
    const sql = getSql()
    // Skip brand-new rows when the call_log already ended (late async upsert
    // after hangup). ON CONFLICT also refuses to resurrect terminal statuses.
    const rows = await sql`
      INSERT INTO call_queue (
        user_id, call_control_id, call_session_id, call_log_id,
        caller_e164, business_line_e164, queue_name, status, enqueued_at, updated_at
      )
      SELECT
        ${params.userId},
        ${params.callControlId},
        ${params.callSessionId ?? null},
        ${params.callLogId ?? null},
        ${params.callerE164 ?? null},
        ${params.businessLineE164 ?? null},
        ${queueName},
        'holding',
        now(),
        now()
      WHERE NOT EXISTS (
        SELECT 1
        FROM call_logs cl
        WHERE (
          cl.provider_call_sid = ${params.callControlId}
         
        )
          AND (
            cl.ended_at IS NOT NULL
            OR lower(COALESCE(cl.status, '')) IN (
              'completed', 'busy', 'failed', 'no-answer', 'canceled', 'cancelled'
            )
          )
      )
      ON CONFLICT (call_control_id) DO UPDATE SET
        status = CASE
          WHEN call_queue.status IN (
            'waiting', 'bridging', 'answered', 'left', 'sms_left', 'timed_out'
          ) THEN call_queue.status
          ELSE 'holding'
        END,
        queue_name = EXCLUDED.queue_name,
        caller_e164 = COALESCE(EXCLUDED.caller_e164, call_queue.caller_e164),
        business_line_e164 = COALESCE(EXCLUDED.business_line_e164, call_queue.business_line_e164),
        call_session_id = COALESCE(EXCLUDED.call_session_id, call_queue.call_session_id),
        updated_at = now()
      WHERE call_queue.status NOT IN ('left', 'sms_left', 'timed_out', 'answered')
      RETURNING *
    `
    const row = rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null
    if (row) void broadcastQueue(params.userId)
    return row
  } catch (e) {
    if (isMissingCallQueueTable(e)) {
      console.warn(
        lyncrLog("call-queue-table-missing", {
          hint: "Run scripts/129-call-queue.sql in Neon",
        })
      )
      return null
    }
    throw e
  }
}

/** Insert or refresh a waiting row when a caller enters the hold queue. */
export async function upsertCallQueueWaiting(params: {
  userId: string
  callControlId: string
  callSessionId?: string | null
  callerE164?: string | null
  businessLineE164?: string | null
  callLogId?: string | null
}): Promise<CallQueueRow | null> {
  const queueName = lyncrHoldQueueName(params.userId)
  try {
    const sql = getSql()
    const rows = await sql`
      INSERT INTO call_queue (
        user_id, call_control_id, call_session_id, call_log_id,
        caller_e164, business_line_e164, queue_name, status, enqueued_at, updated_at
      )
      VALUES (
        ${params.userId},
        ${params.callControlId},
        ${params.callSessionId ?? null},
        ${params.callLogId ?? null},
        ${params.callerE164 ?? null},
        ${params.businessLineE164 ?? null},
        ${queueName},
        'waiting',
        now(),
        now()
      )
      ON CONFLICT (call_control_id) DO UPDATE SET
        status = 'waiting',
        queue_name = EXCLUDED.queue_name,
        caller_e164 = COALESCE(EXCLUDED.caller_e164, call_queue.caller_e164),
        business_line_e164 = COALESCE(EXCLUDED.business_line_e164, call_queue.business_line_e164),
        call_session_id = COALESCE(EXCLUDED.call_session_id, call_queue.call_session_id),
        left_at = NULL,
        updated_at = now()
      WHERE call_queue.status NOT IN ('left', 'sms_left', 'timed_out', 'answered')
      RETURNING *
    `
    const row = rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null
    void broadcastQueue(params.userId)
    return row
  } catch (e) {
    if (isMissingCallQueueTable(e)) {
      console.warn(
        lyncrLog("call-queue-table-missing", {
          hint: "Run scripts/129-call-queue.sql in Neon",
        })
      )
      return null
    }
    throw e
  }
}

export async function getCallQueueById(id: string, userId: string): Promise<CallQueueRow | null> {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT * FROM call_queue WHERE id = ${id} AND user_id = ${userId} LIMIT 1
    `
    return rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingCallQueueTable(e)) return null
    throw e
  }
}

/**
 * True when this call_log ever had a call_queue row — i.e. the caller waited on
 * hold at some point, regardless of current status (answered/left/timed_out all
 * still count). Used at booking time to tag a job as "answered from the hold
 * queue" distinctly from a directly-answered call, so CRM can tell them apart.
 *
 * call_queue rows key off Telnyx's own call_control_id (matches call_logs.provider_
 * call_sid — same join sweepStaleCallQueueForUser already uses), not call_queue.
 * call_log_id: enterBusyHoldQueue's upsertCallQueueWaiting call never actually
 * passes a call_log_id, so that column is null on most rows and can't be trusted
 * as the lookup key.
 */
export async function wasCallLogFromHoldQueue(callLogId: string): Promise<boolean> {
  const id = callLogId.trim()
  if (!id) return false
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT 1
      FROM call_queue cq
      JOIN call_logs cl ON cl.provider_call_sid = cq.call_control_id
      WHERE cl.id = ${id}::uuid
      LIMIT 1
    `
    return rows.length > 0
  } catch (e) {
    if (isMissingCallQueueTable(e)) return false
    console.warn(lyncrLog("call-queue-hold-origin-check-failed", { error: String(e) }))
    return false
  }
}

/**
 * Current status by Telnyx call_control_id — lets a hold-loop webhook handler tell a fresh
 * gather-ended event apart from a stale one that outlived an already-answered/bridged call
 * (a pending gather isn't guaranteed to be canceled before the bridge happens).
 */
export async function getCallQueueStatusByCallControlId(
  callControlId: string
): Promise<CallQueueStatus | null> {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT status FROM call_queue WHERE call_control_id = ${callControlId} LIMIT 1
    `
    return rows[0] ? (String((rows[0] as { status: string }).status) as CallQueueStatus) : null
  } catch (e) {
    if (isMissingCallQueueTable(e)) return null
    throw e
  }
}

/** Mark queue row left / timed_out / sms_left / answered. */
export async function updateCallQueueStatus(params: {
  callControlId: string
  status: CallQueueStatus
  answeredByUserId?: string | null
}): Promise<void> {
  try {
    const sql = getSql()
    const answered = params.status === "answered"
    const left =
      params.status === "left" ||
      params.status === "timed_out" ||
      params.status === "sms_left"
    const rows = await sql`
      UPDATE call_queue
      SET
        status = ${params.status},
        answered_by_user_id = CASE
          WHEN ${answered} THEN ${params.answeredByUserId ?? null}
          ELSE answered_by_user_id
        END,
        answered_at = CASE WHEN ${answered} THEN now() ELSE answered_at END,
        left_at = CASE WHEN ${left} THEN now() ELSE left_at END,
        updated_at = now()
      WHERE call_control_id = ${params.callControlId}
      RETURNING user_id
    `
    const userId = rows[0] ? String((rows[0] as { user_id: string }).user_id) : ""
    if (userId) void broadcastQueue(userId)
  } catch (e) {
    if (isMissingCallQueueTable(e)) return
    console.warn(lyncrLog("call-queue-status-update-failed", { error: String(e) }))
  }
}

/**
 * Merge an answer captured on hold into call_queue.collected (never overwrites the
 * whole object — same coalesce-and-concat pattern as ai_leads.collected). Broadcasts
 * the updated queue so Lines shows the answer before the operator presses Answer.
 * No-ops quietly (never crashes the hold loop) if 170 hasn't been applied yet.
 */
export async function mergeCallQueueCollected(
  callControlId: string,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    const sql = getSql()
    const rows = await sql`
      UPDATE call_queue
      SET
        collected = coalesce(collected, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
        updated_at = now()
      WHERE call_control_id = ${callControlId}
      RETURNING user_id
    `
    const userId = rows[0] ? String((rows[0] as { user_id: string }).user_id) : ""
    if (userId) void broadcastQueue(userId)
  } catch (e) {
    if (isMissingCallQueueTable(e) || isMissingCollectedColumn(e)) {
      console.warn(
        lyncrLog("call-queue-collected-column-missing", {
          hint: "Run scripts/170-hold-queue-intake-answers.sql in Neon",
        })
      )
      return
    }
    console.warn(lyncrLog("call-queue-collected-merge-failed", { error: String(e) }))
  }
}

/** Attach a completed booking form to this caller's active, link-sent hold call. */
export async function recordBookingFormOnActiveHold(params: {
  ownerUserId: string
  callerE164: string
  businessLineE164: string
  leadId: string
  customerName: string
  jobType: string
}): Promise<string | null> {
  try {
    const sql = getSql()
    const rows = await sql`
      UPDATE call_queue
      SET collected = coalesce(collected, '{}'::jsonb) || ${JSON.stringify({
        booking_form_lead_id: params.leadId,
        booking_form_customer_name: params.customerName,
        booking_form_job_type: params.jobType,
      })}::jsonb,
      updated_at = now()
      WHERE id = (
        SELECT id FROM call_queue
        WHERE user_id = ${params.ownerUserId}::uuid
          AND caller_e164 = ${params.callerE164}
          AND business_line_e164 = ${params.businessLineE164}
          AND status IN ('waiting', 'holding')
          AND enqueued_at > now() - interval '2 hours'
          AND collected->>'booking_link_sent' = 'true'
        ORDER BY enqueued_at DESC LIMIT 1
      )
      RETURNING call_control_id, user_id
    `
    const row = rows[0] as { call_control_id?: string; user_id?: string } | undefined
    if (row?.user_id) void broadcastQueue(row.user_id)
    return row?.call_control_id || null
  } catch (e) {
    console.warn(lyncrLog("call-queue-booking-form-update-failed", { error: String(e) }))
    return null
  }
}

/** Only one hold webhook may play the form-received announcement. */
export async function claimBookingFormHoldAcknowledgment(callControlId: string): Promise<boolean> {
  try {
    const sql = getSql()
    const rows = await sql`
      UPDATE call_queue
      SET collected = coalesce(collected, '{}'::jsonb) || '{"booking_form_acknowledged":true}'::jsonb,
          updated_at = now()
      WHERE call_control_id = ${callControlId}
        AND status IN ('waiting', 'holding')
        AND collected->>'booking_form_lead_id' IS NOT NULL
        AND coalesce(collected->>'booking_form_acknowledged', 'false') = 'false'
      RETURNING id
    `
    return rows.length > 0
  } catch (e) {
    console.warn(lyncrLog("call-queue-booking-form-ack-claim-failed", { error: String(e) }))
    return false
  }
}

/** A callback requested after form submission belongs on the existing lead. */
export async function markBookingFormLeadCallback(params: {
  ownerUserId: string
  leadId: string
  callbackE164: string
}): Promise<{ collected: Record<string, unknown>; summary: string | null; intentSlug: string | null } | null> {
  try {
    const sql = getSql()
    const rows = await sql`
      UPDATE ai_leads
      SET collected = coalesce(collected, '{}'::jsonb) || ${JSON.stringify({
        callback_requested: true,
        callback_number: params.callbackE164,
        pending_callback: true,
        sales_recovery_stage: "pending_callbacks",
      })}::jsonb
      WHERE id = ${params.leadId}::uuid
        AND user_id = ${params.ownerUserId}::uuid
      RETURNING collected, summary, intent_slug
    `
    const row = rows[0] as { collected?: Record<string, unknown>; summary?: string | null; intent_slug?: string | null } | undefined
    return row
      ? { collected: row.collected || {}, summary: row.summary || null, intentSlug: row.intent_slug || null }
      : null
  } catch (e) {
    console.warn(lyncrLog("booking-form-callback-update-failed", { error: String(e) }))
    return null
  }
}

/** Read call_queue.collected — used to carry intake answers over into a callback lead. */
export async function getCallQueueCollectedByCallControlId(
  callControlId: string
): Promise<Record<string, unknown>> {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT collected FROM call_queue WHERE call_control_id = ${callControlId} LIMIT 1
    `
    const collected = (rows[0] as { collected?: unknown } | undefined)?.collected
    return collected && typeof collected === "object" ? (collected as Record<string, unknown>) : {}
  } catch (e) {
    if (isMissingCallQueueTable(e) || isMissingCollectedColumn(e)) return {}
    console.warn(lyncrLog("call-queue-collected-read-failed", { error: String(e) }))
    return {}
  }
}

/**
 * Most recent PRIOR hold-queue answers from this same caller (any earlier call, this
 * shop), within the window — lets a caller who already answered on a call an hour ago
 * skip being asked the exact same questions again on a callback. Excludes the current
 * call explicitly so a still-open row for THIS call never matches itself. Returns how
 * long ago that prior call was too — a callback minutes later is almost certainly about
 * the SAME request (a dropped call, retrying); one from yesterday might not be, so the
 * caller picks different acknowledgment copy based on this rather than treating every
 * match identically.
 */
export async function getRecentHoldIntakeForCaller(
  userId: string,
  callerE164: string,
  excludeCallControlId: string,
  withinHours = 24
): Promise<{ collected: Record<string, unknown>; minutesAgo: number } | null> {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT collected, extract(epoch from (now() - enqueued_at)) / 60 AS minutes_ago
      FROM call_queue
      WHERE user_id = ${userId}
        AND caller_e164 = ${callerE164}
        AND call_control_id <> ${excludeCallControlId}
        AND collected IS NOT NULL
        AND collected <> '{}'::jsonb
        AND enqueued_at > now() - (${withinHours}::text || ' hours')::interval
      ORDER BY enqueued_at DESC
      LIMIT 1
    `
    const row = rows[0] as { collected?: unknown; minutes_ago?: unknown } | undefined
    const collected = row?.collected
    if (!collected || typeof collected !== "object" || Object.keys(collected).length === 0) return null
    const minutesAgo = Number(row?.minutes_ago)
    return { collected: collected as Record<string, unknown>, minutesAgo: Number.isFinite(minutesAgo) ? minutesAgo : withinHours * 60 }
  } catch (e) {
    if (isMissingCallQueueTable(e) || isMissingCollectedColumn(e)) return null
    console.warn(lyncrLog("call-queue-recent-intake-lookup-failed", { error: String(e) }))
    return null
  }
}

/** 1-based position in the waiting queue (for “you’re next” TTS). */
export async function getCallQueuePosition(
  userId: string,
  callControlId: string
): Promise<number | null> {
  const waiting = await listWaitingCallQueue(userId)
  const idx = waiting.findIndex((w) => w.call_control_id === callControlId)
  return idx >= 0 ? idx + 1 : null
}

export type AccountHoldSettings = {
  holdMusicUrl: string | null
  /** Null = use env / product default. */
  holdMaxWaitSecs: number | null
  /** Null = use env / product default (seconds between re-prompts). */
  holdRepromptSecs: number | null
}

/** Hold music + optional max-wait / re-prompt (129 + 130). */
export async function getAccountHoldSettings(userId: string): Promise<AccountHoldSettings> {
  const empty: AccountHoldSettings = {
    holdMusicUrl: null,
    holdMaxWaitSecs: null,
    holdRepromptSecs: null,
  }
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT hold_music_url, hold_max_wait_secs, hold_reprompt_secs
      FROM account_settings WHERE user_id = ${userId} LIMIT 1
    `
    const row = rows[0] as
      | {
          hold_music_url?: string | null
          hold_max_wait_secs?: number | null
          hold_reprompt_secs?: number | null
        }
      | undefined
    if (!row) return empty
    const url = String(row.hold_music_url || "").trim()
    const maxWait =
      row.hold_max_wait_secs != null && Number.isFinite(Number(row.hold_max_wait_secs))
        ? Math.floor(Number(row.hold_max_wait_secs))
        : null
    const reprompt =
      row.hold_reprompt_secs != null && Number.isFinite(Number(row.hold_reprompt_secs))
        ? Math.floor(Number(row.hold_reprompt_secs))
        : null
    return {
      // Presets store portable /audio/… paths; custom hosts use https://…
      holdMusicUrl:
        url.startsWith("http") || url.startsWith("/audio/") ? url : null,
      holdMaxWaitSecs: maxWait,
      holdRepromptSecs: reprompt,
    }
  } catch (e) {
    // 130 not applied yet — fall back to music-only query from 129.
    if (isMissingHoldTuningColumn(e)) {
      try {
        const sql = getSql()
        const rows = await sql`
          SELECT hold_music_url FROM account_settings WHERE user_id = ${userId} LIMIT 1
        `
        const url = rows[0]
          ? String((rows[0] as { hold_music_url?: string | null }).hold_music_url || "").trim()
          : ""
        return {
          holdMusicUrl:
            url.startsWith("http") || url.startsWith("/audio/") ? url : null,
          holdMaxWaitSecs: null,
          holdRepromptSecs: null,
        }
      } catch (e2) {
        if (isMissingHoldMusicColumn(e2) || isMissingCallQueueTable(e2)) return empty
        const msg = String((e2 as { message?: string })?.message || e2 || "").toLowerCase()
        if (msg.includes("account_settings") && msg.includes("does not exist")) return empty
        throw e2
      }
    }
    if (isMissingHoldMusicColumn(e) || isMissingCallQueueTable(e)) return empty
    const msg = String((e as { message?: string })?.message || e || "").toLowerCase()
    if (msg.includes("account_settings") && msg.includes("does not exist")) return empty
    throw e
  }
}

export async function setAccountHoldSettings(
  userId: string,
  patch: {
    holdMusicUrl?: string | null
    holdMaxWaitSecs?: number | null
    holdRepromptSecs?: number | null
  }
): Promise<void> {
  const cleanedMusic =
    patch.holdMusicUrl === undefined
      ? undefined
      : typeof patch.holdMusicUrl === "string" &&
          (patch.holdMusicUrl.trim().startsWith("http") ||
            patch.holdMusicUrl.trim().startsWith("/audio/"))
        ? patch.holdMusicUrl.trim()
        : null
  const cleanedMax =
    patch.holdMaxWaitSecs === undefined
      ? undefined
      : patch.holdMaxWaitSecs == null
        ? null
        : Math.min(900, Math.max(120, Math.floor(Number(patch.holdMaxWaitSecs))))
  const cleanedReprompt =
    patch.holdRepromptSecs === undefined
      ? undefined
      : patch.holdRepromptSecs == null
        ? null
        : Math.min(90, Math.max(20, Math.floor(Number(patch.holdRepromptSecs))))

  try {
    const sql = getSql()
    const existing = await getAccountHoldSettings(userId)
    const nextMusic = cleanedMusic !== undefined ? cleanedMusic : existing.holdMusicUrl
    const nextMax = cleanedMax !== undefined ? cleanedMax : existing.holdMaxWaitSecs
    const nextReprompt =
      cleanedReprompt !== undefined ? cleanedReprompt : existing.holdRepromptSecs

    await sql`
      INSERT INTO account_settings (
        user_id, presence_status, presence_closed_manual,
        hold_music_url, hold_max_wait_secs, hold_reprompt_secs, updated_at
      )
      VALUES (
        ${userId}, 'AVAILABLE', false,
        ${nextMusic}, ${nextMax}, ${nextReprompt}, now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        hold_music_url = EXCLUDED.hold_music_url,
        hold_max_wait_secs = EXCLUDED.hold_max_wait_secs,
        hold_reprompt_secs = EXCLUDED.hold_reprompt_secs,
        updated_at = now()
    `
  } catch (e) {
    if (isMissingHoldTuningColumn(e)) {
      // 130 not applied — save music only (129).
      if (cleanedMusic !== undefined) {
        try {
          const sql = getSql()
          await sql`
            INSERT INTO account_settings (user_id, presence_status, presence_closed_manual, hold_music_url, updated_at)
            VALUES (${userId}, 'AVAILABLE', false, ${cleanedMusic}, now())
            ON CONFLICT (user_id) DO UPDATE SET
              hold_music_url = EXCLUDED.hold_music_url,
              updated_at = now()
          `
        } catch (e2) {
          if (isMissingHoldMusicColumn(e2)) {
            const err = new Error(
              "hold_music_url missing — run scripts/129-call-queue.sql in Neon."
            )
            ;(err as Error & { code?: string }).code = "HOLD_QUEUE_MIGRATION_REQUIRED"
            throw err
          }
          throw e2
        }
      }
      if (cleanedMax !== undefined || cleanedReprompt !== undefined) {
        const err = new Error(
          "Hold wait settings need scripts/130-hold-queue-tuning.sql in Neon."
        )
        ;(err as Error & { code?: string }).code = "HOLD_TUNING_MIGRATION_REQUIRED"
        throw err
      }
      return
    }
    if (isMissingHoldMusicColumn(e)) {
      const err = new Error(
        "hold_music_url missing — run scripts/129-call-queue.sql in Neon."
      )
      ;(err as Error & { code?: string }).code = "HOLD_QUEUE_MIGRATION_REQUIRED"
      throw err
    }
    throw e
  }
}


/** Light today rollup for Lines — wait / Answer / press-1 / abandon. */
export async function getHoldQueueDayStats(
  userId: string,
  timezone?: string | null
): Promise<{
  waiting: number
  answered: number
  press1: number
  abandoned: number
  avgWaitSecs: number | null
}> {
  const empty = {
    waiting: 0,
    answered: 0,
    press1: 0,
    abandoned: 0,
    avgWaitSecs: null as number | null,
  }
  try {
    // Clear ghost LIVE rows before counting — otherwise avg wait / waiting skew.
    await sweepStaleCallQueueForUser(userId)
    const sql = getSql()
    // Cap per-row wait so one abandoned ghost (e.g. 885s) cannot dominate the average.
    const maxWaitCap = holdMaxWaitSecs(null)
    // Owner-local calendar day (Louisville 8pm is still “today”, not UTC tomorrow).
    const tz = sanitizeIanaTimezone(timezone)
    const rows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('waiting', 'holding', 'bridging'))::int AS waiting,
        COUNT(*) FILTER (
          WHERE status = 'answered'
            AND date_trunc('day', timezone(${tz}, enqueued_at))
              = date_trunc('day', timezone(${tz}, now()))
        )::int AS answered,
        COUNT(*) FILTER (
          WHERE status = 'sms_left'
            AND date_trunc('day', timezone(${tz}, enqueued_at))
              = date_trunc('day', timezone(${tz}, now()))
        )::int AS press1,
        COUNT(*) FILTER (
          WHERE status IN ('left', 'timed_out')
            AND date_trunc('day', timezone(${tz}, enqueued_at))
              = date_trunc('day', timezone(${tz}, now()))
        )::int AS abandoned,
        ROUND(
          AVG(
            LEAST(
              ${maxWaitCap}::float8,
              EXTRACT(
                EPOCH FROM (
                  COALESCE(answered_at, left_at, updated_at) - enqueued_at
                )
              )
            )
          ) FILTER (
            WHERE status IN ('answered', 'sms_left', 'left', 'timed_out')
              AND date_trunc('day', timezone(${tz}, enqueued_at))
                = date_trunc('day', timezone(${tz}, now()))
              AND COALESCE(answered_at, left_at, updated_at) IS NOT NULL
              AND COALESCE(answered_at, left_at, updated_at) >= enqueued_at
          )
        )::float8 AS avg_wait_secs
      FROM call_queue
      WHERE user_id = ${userId}
    `
    const row = rows[0] as
      | {
          waiting?: number
          answered?: number
          press1?: number
          abandoned?: number
          avg_wait_secs?: number | null
        }
      | undefined
    if (!row) return empty
    const avg =
      row.avg_wait_secs != null && Number.isFinite(Number(row.avg_wait_secs))
        ? Math.max(0, Math.min(maxWaitCap, Math.round(Number(row.avg_wait_secs))))
        : null
    return {
      waiting: Number(row.waiting ?? 0),
      answered: Number(row.answered ?? 0),
      press1: Number(row.press1 ?? 0),
      abandoned: Number(row.abandoned ?? 0),
      avgWaitSecs: avg,
    }
  } catch (e) {
    if (isMissingCallQueueTable(e)) return empty
    throw e
  }
}

/**
 * Platform-wide hold-queue health for the admin dashboard (every tenant, not one owner —
 * pairs with getPlatformCallHealthSummary in lib/db.ts). Aggregated in JS rather than SQL
 * to keep the intake-capture heuristics readable; row volume per window is modest.
 */
export async function getPlatformHoldQueueHealthSummary(days = 7): Promise<{
  window_days: number
  total_calls: number
  answered: number
  left: number
  timed_out: number
  sms_left: number
  still_open: number
  answered_rate_percent: number
  avg_wait_before_answer_secs: number | null
  avg_wait_before_leaving_secs: number | null
  /**
   * % of terminal (non-waiting) rows with an intent_slug captured on hold. This is a
   * FLOOR, not a true answer-when-asked rate — plenty of terminal rows resolve (answered
   * or abandoned) before the caller ever reaches the first reprompt cycle where the
   * question is asked, and this counts those as "didn't answer" too. Still directionally
   * useful for spotting whether the feature is producing data at all.
   */
  intake_capture_rate_percent: number
  /** Of rows with an intent_slug, how many also got the Phase-2 follow-up (vehicle_year). */
  followup_capture_rate_percent: number
  /** Accounts with the most abandoned (left/timed_out) hold sessions in the window. */
  top_abandoning_accounts: { business_name: string; abandoned: number; total: number }[]
}> {
  const empty = {
    window_days: days,
    total_calls: 0,
    answered: 0,
    left: 0,
    timed_out: 0,
    sms_left: 0,
    still_open: 0,
    answered_rate_percent: 0,
    avg_wait_before_answer_secs: null as number | null,
    avg_wait_before_leaving_secs: null as number | null,
    intake_capture_rate_percent: 0,
    followup_capture_rate_percent: 0,
    top_abandoning_accounts: [] as { business_name: string; abandoned: number; total: number }[],
  }
  type Row = {
    status: CallQueueStatus
    enqueued_at: Date | string
    answered_at: Date | string | null
    left_at: Date | string | null
    collected: Record<string, unknown> | null
    business_name: string
  }
  try {
    const sql = getSql()
    const maxWaitCap = holdMaxWaitSecs(null)
    const rawRows = (await sql`
      SELECT cq.status, cq.enqueued_at, cq.answered_at, cq.left_at, cq.collected,
             coalesce(nullif(trim(u.business_name), ''), u.email, 'Unknown') AS business_name
      FROM call_queue cq
      JOIN users u ON u.id = cq.user_id
      WHERE cq.enqueued_at >= now() - (${days}::numeric * interval '1 day')
    `) as Record<string, unknown>[]

    const rows: Row[] = rawRows.map((r) => ({
      status: String(r.status) as CallQueueStatus,
      enqueued_at: r.enqueued_at as Date | string,
      answered_at: r.answered_at as Date | string | null,
      left_at: r.left_at as Date | string | null,
      collected: (r.collected as Record<string, unknown> | null) ?? null,
      business_name: String(r.business_name ?? "Unknown"),
    }))

    const toMs = (v: Date | string | null): number | null => {
      if (v == null) return null
      const t = v instanceof Date ? v.getTime() : Date.parse(v)
      return Number.isFinite(t) ? t : null
    }

    let answered = 0
    let left = 0
    let timedOut = 0
    let smsLeft = 0
    let stillOpen = 0
    const waitBeforeAnswer: number[] = []
    const waitBeforeLeaving: number[] = []
    let terminalCount = 0
    let intakeCaptured = 0
    let followUpCaptured = 0
    const abandonedByAccount = new Map<string, { abandoned: number; total: number }>()

    for (const row of rows) {
      const enqueuedMs = toMs(row.enqueued_at)
      const isTerminal = row.status !== "waiting" && row.status !== "holding" && row.status !== "bridging"
      const isAbandoned = row.status === "left" || row.status === "timed_out"

      if (row.status === "answered") answered += 1
      else if (row.status === "left") left += 1
      else if (row.status === "timed_out") timedOut += 1
      else if (row.status === "sms_left") smsLeft += 1
      else stillOpen += 1

      if (row.status === "answered" && enqueuedMs != null) {
        const answeredMs = toMs(row.answered_at)
        if (answeredMs != null && answeredMs >= enqueuedMs) {
          waitBeforeAnswer.push(Math.min(maxWaitCap, (answeredMs - enqueuedMs) / 1000))
        }
      }
      if (isAbandoned && enqueuedMs != null) {
        const leftMs = toMs(row.left_at)
        if (leftMs != null && leftMs >= enqueuedMs) {
          waitBeforeLeaving.push(Math.min(maxWaitCap, (leftMs - enqueuedMs) / 1000))
        }
        const acct = abandonedByAccount.get(row.business_name) ?? { abandoned: 0, total: 0 }
        acct.abandoned += 1
        abandonedByAccount.set(row.business_name, acct)
      }

      if (isTerminal) {
        terminalCount += 1
        const intentSlug = row.collected?.intent_slug
        if (typeof intentSlug === "string" && intentSlug.trim()) {
          intakeCaptured += 1
          const vehicleYear = row.collected?.vehicle_year
          if (typeof vehicleYear === "string" && vehicleYear.trim()) followUpCaptured += 1
        }
      }
    }
    // Second pass: each flagged account's total terminal rows (denominator for the leaderboard).
    for (const [name, acct] of abandonedByAccount) {
      acct.total = rows.filter(
        (r) => r.business_name === name && r.status !== "waiting" && r.status !== "holding" && r.status !== "bridging"
      ).length
    }

    const round1 = (n: number) => Math.round(n * 10) / 10

    return {
      window_days: days,
      total_calls: rows.length,
      answered,
      left,
      timed_out: timedOut,
      sms_left: smsLeft,
      still_open: stillOpen,
      answered_rate_percent:
        terminalCount === 0 ? 0 : round1((answered / terminalCount) * 100),
      avg_wait_before_answer_secs: average(waitBeforeAnswer),
      avg_wait_before_leaving_secs: average(waitBeforeLeaving),
      intake_capture_rate_percent:
        terminalCount === 0 ? 0 : round1((intakeCaptured / terminalCount) * 100),
      followup_capture_rate_percent:
        intakeCaptured === 0 ? 0 : round1((followUpCaptured / intakeCaptured) * 100),
      top_abandoning_accounts: [...abandonedByAccount.entries()]
        .map(([business_name, acct]) => ({ business_name, abandoned: acct.abandoned, total: acct.total }))
        .sort((a, b) => b.abandoned - a.abandoned)
        .slice(0, 8),
    }
  } catch (e) {
    if (isMissingCallQueueTable(e)) return empty
    throw e
  }
}
