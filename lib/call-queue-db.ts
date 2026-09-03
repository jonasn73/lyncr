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
}

function getSql() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
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
          cq.enqueued_at < now() - (${staleSecs}::text || ' seconds')::interval
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
