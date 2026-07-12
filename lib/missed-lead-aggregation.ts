// Group today's missed rings into unique actionable customer leads.

import { isMissedCallTodayRecord } from "@/lib/missed-call-telemetry"
import { normalizeCallEventPhoneDigits } from "@/lib/realtime/owner-call-event-types"

export type MissedLeadCallRow = {
  id: string
  from_number: string
  to_number?: string | null
  created_at: string
  call_type?: string | null
  status?: string | null
  answered_at?: string | null
  ended_at?: string | null
  routed_to_name?: string | null
}

export type MissedLeadHotProspect = {
  phoneKey: string
  from_number: string
  missCount: number
  latestAt: string
}

/** Banner layout mode derived from the last-30m unreturned prospect set. */
export type MissedLeadRecoveryMode =
  | { kind: "multi"; uniqueLeadsCount: number; totalMissedEvents: number; maxRepetitionCount: number }
  | {
      kind: "high_urgency"
      uniqueLeadsCount: 1
      totalMissedEvents: number
      maxRepetitionCount: number
      prospect: MissedLeadHotProspect
    }
  | {
      kind: "single"
      uniqueLeadsCount: 1
      totalMissedEvents: number
      maxRepetitionCount: 1
      prospect: MissedLeadHotProspect
    }

/**
 * Evaluate unreturned missed leads for scenario-specific recovery UI.
 * - multi: uniqueLeadsCount > 1
 * - high_urgency: one phone with maxRepetitionCount >= 2
 * - single: one phone with a single miss
 */
export function classifyMissedLeadRecoveryMode(
  prospects: readonly MissedLeadHotProspect[]
): MissedLeadRecoveryMode | null {
  if (prospects.length === 0) return null

  const uniqueLeadsCount = prospects.length
  const totalMissedEvents = prospects.reduce((sum, p) => sum + p.missCount, 0)
  const maxRepetitionCount = Math.max(...prospects.map((p) => p.missCount))

  if (uniqueLeadsCount > 1) {
    return { kind: "multi", uniqueLeadsCount, totalMissedEvents, maxRepetitionCount }
  }

  const prospect = prospects[0]!
  if (maxRepetitionCount >= 2) {
    return {
      kind: "high_urgency",
      uniqueLeadsCount: 1,
      totalMissedEvents,
      maxRepetitionCount,
      prospect,
    }
  }

  return {
    kind: "single",
    uniqueLeadsCount: 1,
    totalMissedEvents,
    maxRepetitionCount: 1,
    prospect,
  }
}

export type MissedLeadInsights = {
  /** Total missed rings today (log rows). */
  totalMissedToday: number
  /** Unique caller phones among today's misses. */
  uniqueLeadsToday: number
  /** Unique phones with an unreturned miss in the last `recentWindowMs`. */
  recentUnreturned: MissedLeadHotProspect[]
}

const DEFAULT_RECENT_MS = 30 * 60 * 1000
const INTERCEPT_STORAGE_KEY = "lyncr-missed-intercept-phones"

function phoneKey(raw: string | null | undefined): string {
  const digits = normalizeCallEventPhoneDigits(raw)
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

export function readInterceptedPhoneKeys(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = sessionStorage.getItem(INTERCEPT_STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.map((v) => phoneKey(String(v))).filter(Boolean))
  } catch {
    return new Set()
  }
}

export function markPhonesIntercepted(phones: string[]): void {
  if (typeof window === "undefined") return
  try {
    const next = readInterceptedPhoneKeys()
    for (const p of phones) {
      const key = phoneKey(p)
      if (key) next.add(key)
    }
    sessionStorage.setItem(INTERCEPT_STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    /* ignore */
  }
}

/** @deprecated Prefer MISSED_LEAD_SMS_TEMPLATES — re-exported for older imports. */
export { MISSED_LEAD_INTERCEPT_SMS } from "@/lib/missed-lead-sms-templates"

/**
 * Aggregate today's missed calls into unique leads + recent unreturned prospects.
 */
export function summarizeMissedLeadInsights(
  rows: readonly MissedLeadCallRow[],
  options?: {
    now?: Date
    recentWindowMs?: number
    interceptedKeys?: ReadonlySet<string>
  }
): MissedLeadInsights {
  const now = options?.now ?? new Date()
  const recentWindowMs = options?.recentWindowMs ?? DEFAULT_RECENT_MS
  const intercepted = options?.interceptedKeys ?? new Set<string>()
  const nowMs = now.getTime()
  const recentStart = nowMs - recentWindowMs

  const todayMissed = rows.filter((row) =>
    isMissedCallTodayRecord(
      {
        call_type: row.call_type,
        status: row.status,
        answered_at: row.answered_at,
        ended_at: row.ended_at,
        routed_to_name: row.routed_to_name ?? null,
        created_at: row.created_at,
      },
      now
    )
  )

  const uniqueToday = new Set<string>()
  const recentByPhone = new Map<string, MissedLeadHotProspect>()

  for (const row of todayMissed) {
    const key = phoneKey(row.from_number)
    if (!key) continue
    uniqueToday.add(key)

    const ms = Date.parse(row.created_at)
    if (!Number.isFinite(ms) || ms < recentStart || ms > nowMs) continue
    if (intercepted.has(key)) continue

    const prev = recentByPhone.get(key)
    if (!prev) {
      recentByPhone.set(key, {
        phoneKey: key,
        from_number: row.from_number,
        missCount: 1,
        latestAt: row.created_at,
      })
    } else {
      prev.missCount += 1
      if (ms > Date.parse(prev.latestAt)) {
        prev.latestAt = row.created_at
        prev.from_number = row.from_number
      }
    }
  }

  const recentUnreturned = [...recentByPhone.values()].sort(
    (a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt)
  )

  return {
    totalMissedToday: todayMissed.length,
    uniqueLeadsToday: uniqueToday.size,
    recentUnreturned,
  }
}

/** Ticker subtext when rings exceed unique people: "8 MISSED (3 LEADS)" */
export function formatMissedTickerLabel(totalMissed: number, uniqueLeads: number): string {
  if (uniqueLeads > 0 && uniqueLeads < totalMissed) {
    return `${totalMissed} MISSED (${uniqueLeads} LEADS)`
  }
  return "MISSED"
}
