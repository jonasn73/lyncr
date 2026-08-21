/**
 * Server-only Activity first paint — real call rows in SSR HTML (Lines-style, no empty flash).
 */

import type { CallActivityContext } from "@/lib/types"
import { getCallLogs } from "@/lib/db"
import type { UiCallRecord, UiCallType } from "@/lib/operations-ui-types"
import {
  DEFAULT_TELEMETRY_TIMEZONE,
  sanitizeIanaTimezone,
} from "@/lib/telemetry-timezone"
import {
  formatListDateLabel,
  formatListTimeLabel,
} from "@/lib/browser-timezone-cookie"

function formatPhoneDisplay(phone: string | undefined | null): string {
  const v = String(phone || "")
  if (!v) return "Unknown"
  const digits = v.replace(/\D/g, "")
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return v
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
  return (parts[0] || "NA").slice(0, 2).toUpperCase()
}

function normalizeCallType(value: unknown): UiCallType {
  const t = String(value || "incoming")
  if (t === "incoming" || t === "outgoing" || t === "missed" || t === "voicemail") return t
  return "incoming"
}

function emptyActivity(): CallActivityContext {
  return {
    intakeAction: "No intake recorded",
    intakeDetail: null,
    scheduleLabel: null,
    scheduleAt: null,
    leadId: null,
    callerScheduleHint: null,
    callerPoolCount: 0,
  }
}

/** Full Activity table seed for hard refresh — accurate statuses + owner-local times. */
export async function getActivitySsrCalls(
  userId: string,
  timeZone?: string | null
): Promise<UiCallRecord[]> {
  const tz = sanitizeIanaTimezone(timeZone) || DEFAULT_TELEMETRY_TIMEZONE
  // Pull recent history on the server so the first HTML already has the real table.
  const calls = await getCallLogs(userId, { limit: 80, offset: 0 })
  return calls.map((c) => {
    // Prefer created_at from the DB; fall back only if a row is somehow missing it.
    const createdAt = c.created_at ? new Date(c.created_at) : new Date()
    const statusRaw = String(c.status || "").toLowerCase()
    const routedToRaw = String(c.routed_to_name || "").trim()
    // Match client mapping so answered / AI labels do not flip after hydrate.
    const routedTo =
      statusRaw.includes("ai") || routedToRaw.toLowerCase().includes("ai")
        ? "AI Receptionist"
        : routedToRaw
    return {
      id: String(c.id),
      type: normalizeCallType(c.call_type),
      callerName: String(c.caller_name || "Unknown Caller"),
      callerNumber: formatPhoneDisplay(c.from_number),
      targetLineE164: String(c.to_number || ""),
      routedTo,
      routedToReceptionistId: c.routed_to_receptionist_id
        ? String(c.routed_to_receptionist_id)
        : null,
      routedInitials: initialsFromName(routedTo),
      routedColor: "bg-primary",
      date: formatListDateLabel(createdAt, tz),
      time: formatListTimeLabel(createdAt, tz),
      createdAt: createdAt.toISOString(),
      rawCallType: String(c.call_type || "incoming"),
      callStatus: String(c.status || ""),
      answeredAt: c.answered_at ? String(c.answered_at) : null,
      endedAt: c.ended_at ? String(c.ended_at) : null,
      durationSeconds: Number(c.duration_seconds || 0),
      hasRecording: Boolean(c.has_recording),
      recordingUrl: c.recording_url ? String(c.recording_url) : null,
      activity: emptyActivity(),
    }
  })
}
