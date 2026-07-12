// Scan today's call activity for desperate repeat callers (missed/dropped in the last 2h).

import { isLocalCalendarToday } from "@/lib/daily-call-telemetry"
import { isMissedCallRecord } from "@/lib/missed-call-telemetry"
import { normalizeCallEventPhoneDigits } from "@/lib/realtime/owner-call-event-types"

/** One historical call row — activity feed or /api/calls payload. */
export type RepeatCallerLogInput = {
  id: string
  from_number?: string | null
  /** Activity UI alias for from_number. */
  callerNumber?: string | null
  created_at?: string | null
  createdAt?: string | null
  call_type?: string | null
  rawCallType?: string | null
  type?: string | null
  status?: string | null
  callStatus?: string | null
  answered_at?: string | null
  answeredAt?: string | null
  ended_at?: string | null
  endedAt?: string | null
}

export type RepeatCallerUrgency = {
  /** Attempt number including the live inbound leg (previous missed + 1). */
  attemptCount: number
  /** Missed/dropped logs from this phone in the last 2 hours (today only). */
  previousMissedCount: number
  /** Minutes since the most recent prior missed attempt. */
  minutesSinceLastMissed: number | null
  lastMissedAt: string | null
  /** True when attemptCount > 1 — show High Urgency badge. */
  isHighUrgency: boolean
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000

function phoneKey(raw: string | null | undefined): string {
  const digits = normalizeCallEventPhoneDigits(raw)
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

function createdAtIso(row: RepeatCallerLogInput): string | null {
  const raw = row.created_at ?? row.createdAt ?? null
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function asMissedInput(row: RepeatCallerLogInput) {
  return {
    call_type: row.call_type ?? row.rawCallType ?? row.type ?? null,
    status: row.status ?? row.callStatus ?? null,
    answered_at: row.answered_at ?? row.answeredAt ?? null,
    ended_at: row.ended_at ?? row.endedAt ?? null,
  }
}

/**
 * Count today's missed/dropped attempts from this phone in the last 2 hours,
 * then derive the live attempt number (prior misses + current ring).
 */
export function resolveRepeatCallerUrgency(
  phoneNumber: string,
  logs: readonly RepeatCallerLogInput[],
  options?: {
    now?: Date
    /** Exclude the live ringing/answered call log id so it is not double-counted. */
    excludeCallId?: string | null
    windowMs?: number
  }
): RepeatCallerUrgency {
  const now = options?.now ?? new Date()
  const windowMs = options?.windowMs ?? TWO_HOURS_MS
  const excludeId = String(options?.excludeCallId ?? "").trim()
  const target = phoneKey(phoneNumber)

  const empty: RepeatCallerUrgency = {
    attemptCount: 1,
    previousMissedCount: 0,
    minutesSinceLastMissed: null,
    lastMissedAt: null,
    isHighUrgency: false,
  }

  if (!target || target.length < 7) return empty

  const nowMs = now.getTime()
  const windowStart = nowMs - windowMs

  const priorMissed: { id: string; at: string; ms: number }[] = []

  for (const row of logs) {
    const id = String(row.id ?? "").trim()
    if (!id || (excludeId && id === excludeId)) continue
    // Also skip synthetic ring aliases that share the live sid.
    if (excludeId && excludeId.startsWith("ring-") && id === excludeId) continue

    const from = row.from_number ?? row.callerNumber ?? ""
    if (phoneKey(from) !== target) continue

    const at = createdAtIso(row)
    if (!at || !isLocalCalendarToday(at, now)) continue
    if (!isMissedCallRecord(asMissedInput(row))) continue

    const ms = Date.parse(at)
    if (!Number.isFinite(ms) || ms < windowStart || ms > nowMs) continue

    priorMissed.push({ id, at, ms })
  }

  priorMissed.sort((a, b) => b.ms - a.ms)
  const previousMissedCount = priorMissed.length
  const attemptCount = previousMissedCount + 1
  const last = priorMissed[0] ?? null
  const minutesSinceLastMissed =
    last != null ? Math.max(0, Math.floor((nowMs - last.ms) / 60_000)) : null

  return {
    attemptCount,
    previousMissedCount,
    minutesSinceLastMissed,
    lastMissedAt: last?.at ?? null,
    isHighUrgency: attemptCount > 1,
  }
}

/** Badge copy: "Attempt #3 • High Urgency" */
export function formatRepeatAttemptBadgeLabel(attemptCount: number): string {
  return `Attempt #${attemptCount} • High Urgency`
}

/** Micro context: "Last attempt was missed 12 minutes ago." */
export function formatRepeatCallerHistoryLine(minutesAgo: number): string {
  if (minutesAgo <= 0) return "Last attempt was missed just now."
  if (minutesAgo === 1) return "Last attempt was missed 1 minute ago."
  return `Last attempt was missed ${minutesAgo} minutes ago.`
}
