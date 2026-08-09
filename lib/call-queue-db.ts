// ============================================
// call_queue Neon helpers — Lines waiting list + Answer
// ============================================
// Requires scripts/129-call-queue.sql. Missing-table errors are swallowed so
// voice keeps working before the migration is run (queue UI just shows empty).

import { neon } from "@neondatabase/serverless"
import { lyncrHoldQueueName } from "@/lib/hold-queue"
import { lyncrLog } from "@/lib/lyncr-env"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"

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

/** Waiting list for Lines UI (oldest first). */
export async function listWaitingCallQueue(userId: string): Promise<CallQueueRow[]> {
  try {
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

export async function getCallQueueByCallControlId(callControlId: string): Promise<CallQueueRow | null> {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT * FROM call_queue WHERE call_control_id = ${callControlId} LIMIT 1
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

/** Optional per-account hold music from Greetings (migration 129). */
export async function getAccountHoldMusicUrl(userId: string): Promise<string | null> {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT hold_music_url FROM account_settings WHERE user_id = ${userId} LIMIT 1
    `
    const url = rows[0] ? String((rows[0] as { hold_music_url?: string | null }).hold_music_url || "").trim() : ""
    return url.startsWith("http") ? url : null
  } catch (e) {
    if (isMissingHoldMusicColumn(e) || isMissingCallQueueTable(e)) return null
    const msg = String((e as { message?: string })?.message || e || "").toLowerCase()
    if (msg.includes("account_settings") && msg.includes("does not exist")) return null
    throw e
  }
}

export async function setAccountHoldMusicUrl(
  userId: string,
  holdMusicUrl: string | null
): Promise<void> {
  const cleaned =
    typeof holdMusicUrl === "string" && holdMusicUrl.trim().startsWith("http")
      ? holdMusicUrl.trim()
      : null
  try {
    const sql = getSql()
    await sql`
      INSERT INTO account_settings (user_id, presence_status, presence_closed_manual, hold_music_url, updated_at)
      VALUES (${userId}, 'AVAILABLE', false, ${cleaned}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        hold_music_url = EXCLUDED.hold_music_url,
        updated_at = now()
    `
  } catch (e) {
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
