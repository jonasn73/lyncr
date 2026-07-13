// Collapse consecutive activity rows that share the same caller number.

import type { UiCallRecord } from "@/lib/hooks/use-operations-data"
import {
  isAutomatedCallHandler,
  isIvrMenuHandler,
  isMissedCallRecord,
} from "@/lib/missed-call-telemetry"

/** One feed row — latest call fields kept, with how many consecutive matches were folded in. */
export type GroupedActivityCall = UiCallRecord & {
  /** Total consecutive calls collapsed into this row (always >= 1). */
  count: number
  /** How many of those collapsed calls landed on the local calendar day. */
  todayCount: number
  /** Ids of every call in the group (newest first). */
  groupIds: string[]
  /** Full member rows newest-first — powers expandable chronology. */
  members: UiCallRecord[]
}

/** Digits-only key so +15551234567 and (555) 123-4567 group together. */
export function activityCallerPhoneKey(phone: string | null | undefined): string {
  const raw = (phone ?? "").trim()
  if (!raw || raw === "—") return ""
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1)
  return digits
}

function isCreatedToday(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso?.trim()) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

/**
 * Walk a newest-first call list and fold consecutive same-number rows.
 * Keeps the first (latest) call’s fields and accumulates count / todayCount / members.
 */
export function groupConsecutiveCallsByPhone(
  calls: UiCallRecord[],
  now: Date = new Date()
): GroupedActivityCall[] {
  const groups: GroupedActivityCall[] = []

  for (const call of calls) {
    const key = activityCallerPhoneKey(call.callerNumber)
    const last = groups[groups.length - 1]
    const lastKey = last ? activityCallerPhoneKey(last.callerNumber) : ""

    // Only collapse when both sides have a real phone key and they match.
    if (last && key && lastKey && key === lastKey) {
      last.count += 1
      last.groupIds.push(call.id)
      last.members.push(call)
      if (isCreatedToday(call.createdAt, now)) last.todayCount += 1
      continue
    }

    groups.push({
      ...call,
      count: 1,
      todayCount: isCreatedToday(call.createdAt, now) ? 1 : 0,
      groupIds: [call.id],
      members: [call],
    })
  }

  return groups
}

/** Compact relative age for “Last answered 36s ago”. */
export function formatActivityRelativeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso?.trim()) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const sec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  return `${days}d ago`
}

/** Subtitle when a row represents multiple collapsed calls. */
export function formatGroupedCallSummary(group: GroupedActivityCall, now: Date = new Date()): string {
  const ago = formatActivityRelativeAgo(group.createdAt, now)
  const answered = resolveCallWasAnswered(group)
  const lead = answered ? `Last answered ${ago}` : `Last call ${ago}`
  const today = group.todayCount > 0 ? group.todayCount : group.count
  return `${lead} • ${today} total call${today === 1 ? "" : "s"} today`
}

export function resolveCallWasAnswered(call: UiCallRecord): boolean {
  if (call.type === "missed" || call.type === "voicemail") return false
  if (isAutomatedCallHandler(call.routedTo)) return false
  if (
    isMissedCallRecord({
      call_type: call.rawCallType || call.type,
      status: call.callStatus,
      answered_at: call.answeredAt,
      ended_at: call.endedAt,
      routed_to_name: call.routedTo,
    })
  ) {
    return false
  }
  if (call.answeredAt && call.durationSeconds > 0) return true
  return call.durationSeconds > 0 && Boolean(call.answeredAt)
}

/** Short status label for expandable chronology bullets. */
export function formatCallChronologyStatus(call: UiCallRecord): string {
  if (call.type === "voicemail" || /voicemail/i.test(call.routedTo || "")) return "Missed / Voicemail"
  if (call.type === "outgoing") return "Outgoing"
  if (isIvrMenuHandler(call.routedTo)) return "Missed / Left on IVR"
  if (isAutomatedCallHandler(call.routedTo)) return "Missed / Automated"
  if (resolveCallWasAnswered(call)) return "Answered"
  const status = String(call.callStatus || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
  if (status === "no-answer" || status === "busy") return "Missed / No Answer"
  return "Missed / No Answer"
}

/** Local clock time for a chronology bullet (e.g. "9:33 AM"). */
export function formatCallChronologyTime(call: UiCallRecord): string {
  if (call.time?.trim()) return call.time.trim()
  if (!call.createdAt?.trim()) return "—"
  const d = new Date(call.createdAt)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

/** One chronology line: "9:33 AM (Answered)". */
export function formatCallChronologyLine(call: UiCallRecord): string {
  return `${formatCallChronologyTime(call)} (${formatCallChronologyStatus(call)})`
}
