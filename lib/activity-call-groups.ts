// Group Activity feed rows: one row per caller phone per calendar day.

import type { UiCallRecord } from "@/lib/hooks/use-operations-data"
import {
  isAutomatedCallHandler,
  isIvrMenuHandler,
  isMissedCallRecord,
  formatCaptureRoutedStatus,
} from "@/lib/missed-call-telemetry"
import { localDateTimePartsInZone } from "@/lib/schedule-blockouts"
import {
  DEFAULT_TELEMETRY_TIMEZONE,
  resolveBrowserTimezone,
  sanitizeIanaTimezone,
} from "@/lib/telemetry-timezone"

/** One feed row — latest call fields kept, with how many same-day matches were folded in. */
export type GroupedActivityCall = UiCallRecord & {
  /** Total calls collapsed into this row (always >= 1). */
  count: number
  /** How many of those calls landed on “today” in the grouping timezone. */
  todayCount: number
  /** Ids of every call in the group (newest first). */
  groupIds: string[]
  /** Full member rows newest-first — powers expandable chronology + per-leg actions. */
  members: UiCallRecord[]
  /** Stable key for expand/collapse across polls (day + phone, not latest call id). */
  groupKey: string
}

/** Digits-only key so +15551234567 and (555) 123-4567 group together. */
export function activityCallerPhoneKey(phone: string | null | undefined): string {
  // Treat empty / em-dash placeholders as “no phone” (do not merge unknowns).
  const raw = (phone ?? "").trim()
  if (!raw || raw === "—") return ""
  // Strip everything except digits.
  const digits = raw.replace(/\D/g, "")
  // Drop leading US country code so 11-digit and 10-digit forms match.
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1)
  return digits
}

/** Calendar YYYY-MM-DD for a call timestamp in an IANA timezone. */
export function activityCallCalendarDayKey(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_TELEMETRY_TIMEZONE
): string {
  // Prefer createdAt when present.
  if (iso?.trim()) {
    const d = new Date(iso)
    if (!Number.isNaN(d.getTime())) {
      return localDateTimePartsInZone(d, sanitizeIanaTimezone(timeZone)).dateKey
    }
  }
  // Unknown timestamps get their own bucket so they never falsely merge.
  return "unknown"
}

/** True when iso falls on “today” in the given timezone. */
function isCreatedTodayInZone(
  iso: string | null | undefined,
  now: Date,
  timeZone: string
): boolean {
  if (!iso?.trim()) return false
  const day = activityCallCalendarDayKey(iso, timeZone)
  if (day === "unknown") return false
  const today = localDateTimePartsInZone(now, sanitizeIanaTimezone(timeZone)).dateKey
  return day === today
}

/** Build the map key used to fold calls into one Activity row. */
function buildGroupMapKey(call: UiCallRecord, timeZone: string): string {
  const phone = activityCallerPhoneKey(call.callerNumber)
  const day = activityCallCalendarDayKey(call.createdAt, timeZone)
  // No reliable phone → keep each call as its own row.
  if (!phone) return `id:${call.id}`
  return `${day}|${phone}`
}

/** Start timestamp ms for a call (0 when unknown). */
function callStartMs(call: UiCallRecord): number {
  if (!call.createdAt?.trim()) return 0
  const t = new Date(call.createdAt).getTime()
  return Number.isFinite(t) ? t : 0
}

/** Prefer answered, intake-rich, longer legs when collapsing near-duplicates. */
function legQualityScore(call: UiCallRecord): number {
  let score = 0
  if (resolveCallWasAnswered(call)) score += 100
  if (callHasMeaningfulActivity(call)) score += 50
  if (call.hasRecording) score += 10
  score += Math.min(Math.max(0, call.durationSeconds), 600)
  return score
}

/**
 * True when two same-day legs look like one conversation split across rows
 * (webhook double-write, quick redial stub, or back-to-back bridge legs).
 * Uses start-time proximity only — not endedAt overlap (stale ends create false merges).
 */
export function areNearDuplicateCallLegs(
  a: UiCallRecord,
  b: UiCallRecord,
  windowMs: number = 90_000
): boolean {
  const a0 = callStartMs(a)
  const b0 = callStartMs(b)
  if (!a0 || !b0) return false
  if (Math.abs(a0 - b0) > windowMs) return false
  const stub = a.durationSeconds < 15 || b.durationSeconds < 15
  const sameAnswered = resolveCallWasAnswered(a) === resolveCallWasAnswered(b)
  // Keep distinct outcomes close together (missed then answered) unless one is a stub.
  return stub || sameAnswered
}

/**
 * Collapse near-duplicate legs inside a day-group (newest-first in, newest-first out).
 * Keeps the higher-quality row when two SIDs describe the same conversation.
 */
export function collapseNearDuplicateCallLegs(members: UiCallRecord[]): UiCallRecord[] {
  if (members.length <= 1) return members
  const kept: UiCallRecord[] = []
  for (const candidate of members) {
    const dupIdx = kept.findIndex((k) => areNearDuplicateCallLegs(k, candidate))
    if (dupIdx < 0) {
      kept.push(candidate)
      continue
    }
    if (legQualityScore(candidate) > legQualityScore(kept[dupIdx]!)) {
      kept[dupIdx] = candidate
    }
  }
  return kept.sort((a, b) => callStartMs(b) - callStartMs(a))
}

/** Rebuild count / ids / representative after member collapse. */
function finalizeGroupedCall(
  group: GroupedActivityCall,
  now: Date,
  timeZone: string
): GroupedActivityCall {
  const members = collapseNearDuplicateCallLegs(group.members)
  const head = members[0] ?? group
  return {
    ...group,
    ...head,
    count: members.length,
    todayCount: members.filter((m) => isCreatedTodayInZone(m.createdAt, now, timeZone)).length,
    groupIds: members.map((m) => m.id),
    members,
    groupKey: group.groupKey,
  }
}

/**
 * Fold a newest-first call list into one row per normalized phone per calendar day.
 * Representative fields come from the newest member; members stay newest-first.
 */
export function groupCallsByPhoneAndDay(
  calls: UiCallRecord[],
  options?: { now?: Date; timeZone?: string | null }
): GroupedActivityCall[] {
  const now = options?.now ?? new Date()
  const timeZone = sanitizeIanaTimezone(options?.timeZone ?? resolveBrowserTimezone())
  // Preserve first-seen order (newest group first when input is newest-first).
  const order: string[] = []
  const byKey = new Map<string, GroupedActivityCall>()

  for (const call of calls) {
    const key = buildGroupMapKey(call, timeZone)
    const existing = byKey.get(key)
    if (existing) {
      // Same phone + same day → append older leg under the newest representative.
      existing.count += 1
      existing.groupIds.push(call.id)
      existing.members.push(call)
      if (isCreatedTodayInZone(call.createdAt, now, timeZone)) existing.todayCount += 1
      continue
    }

    order.push(key)
    byKey.set(key, {
      ...call,
      count: 1,
      todayCount: isCreatedTodayInZone(call.createdAt, now, timeZone) ? 1 : 0,
      groupIds: [call.id],
      members: [call],
      groupKey: key,
    })
  }

  // Drop phantom near-duplicate SIDs so “· N calls” matches distinct conversations.
  return order.map((k) => finalizeGroupedCall(byKey.get(k)!, now, timeZone))
}

/**
 * @deprecated Prefer groupCallsByPhoneAndDay — kept so older imports keep working.
 * Walk a newest-first list and fold consecutive same-number rows (any day).
 */
export function groupConsecutiveCallsByPhone(
  calls: UiCallRecord[],
  now: Date = new Date()
): GroupedActivityCall[] {
  const groups: GroupedActivityCall[] = []
  const timeZone = resolveBrowserTimezone()

  for (const call of calls) {
    const key = activityCallerPhoneKey(call.callerNumber)
    const last = groups[groups.length - 1]
    const lastKey = last ? activityCallerPhoneKey(last.callerNumber) : ""

    // Only collapse when both sides have a real phone key and they match.
    if (last && key && lastKey && key === lastKey) {
      last.count += 1
      last.groupIds.push(call.id)
      last.members.push(call)
      if (isCreatedTodayInZone(call.createdAt, now, timeZone)) last.todayCount += 1
      continue
    }

    groups.push({
      ...call,
      count: 1,
      todayCount: isCreatedTodayInZone(call.createdAt, now, timeZone) ? 1 : 0,
      groupIds: [call.id],
      members: [call],
      groupKey: buildGroupMapKey(call, timeZone),
    })
  }

  return groups
}

/**
 * When a filter is on, keep groups that have any matching child and surface the
 * latest matching call as the collapsed-row representative (status / time / duration).
 */
export function filterActivityCallGroups(
  groups: GroupedActivityCall[],
  matches: (call: UiCallRecord) => boolean
): GroupedActivityCall[] {
  const out: GroupedActivityCall[] = []
  for (const group of groups) {
    // Newest-first members — first match is the latest matching leg.
    const latestMatch = group.members.find(matches)
    if (!latestMatch) continue
    out.push({
      ...group,
      // Overlay latest matching call fields onto the group shell.
      ...latestMatch,
      count: group.count,
      todayCount: group.todayCount,
      groupIds: group.groupIds,
      members: group.members,
      groupKey: group.groupKey,
    })
  }
  return out
}

/** Compact relative age for “Last answered 36s ago”. */
function formatActivityRelativeAgo(iso: string | null | undefined, now: Date = new Date()): string {
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
  const n = group.count
  return `${lead} • ${n} call${n === 1 ? "" : "s"}`
}

/** Collapsed name suffix: “· 3 calls”. */
export function formatGroupedCallCountLabel(count: number): string {
  if (count <= 1) return ""
  return `· ${count} calls`
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
  const capture = formatCaptureRoutedStatus(call.routedTo)
  if (capture) return capture
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

/** True when this leg has a real job / intake card worth showing once for the group. */
export function callHasMeaningfulActivity(call: UiCallRecord): boolean {
  const activity = call.activity
  if (!activity) return false
  // Empty “No intake” chips are noise when the same job already appears on another leg.
  if (activity.intakeAction === "No intake recorded") return false
  // Prefer anything with a lead, schedule, or written intake detail.
  if (activity.leadId) return true
  if (activity.scheduleLabel || activity.scheduleAt) return true
  if (activity.intakeDetail) return true
  // Named status like “Sent to dispatch” / “Booked” counts even without a lead id yet.
  return Boolean(activity.intakeAction?.trim())
}

/**
 * Pick the single member that should own the group job card (newest meaningful first).
 * Returns null when no leg has real intake — callers hide the card then.
 */
export function pickGroupJobActivityCall(members: UiCallRecord[]): UiCallRecord | null {
  // Members are newest-first; first meaningful hit is the latest job touch for this phone/day.
  for (const member of members) {
    if (callHasMeaningfulActivity(member)) return member
  }
  return null
}
