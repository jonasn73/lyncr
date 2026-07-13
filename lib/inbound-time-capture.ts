// Time-based inbound capture — night sleep protection + day busy fallback.
// Timezone: America/New_York (Eastern). Night = 8 PM – 8 AM local.
// Calendar blockouts (full-day / partial) override ringing when active.

import {
  localDateTimePartsInZone,
  resolveInboundCalendarOverride,
} from "@/lib/schedule-blockouts"
import { listScheduleBlockoutsForDate } from "@/lib/schedule-blockouts-db"
import { getAccountPresence } from "@/lib/account-presence"

export const INBOUND_CAPTURE_TIMEZONE = "America/New_York"

/** Night window: 8:00 PM inclusive through 7:59 AM. */
export function isNightMode(
  now: Date = new Date(),
  timeZone: string = INBOUND_CAPTURE_TIMEZONE
): boolean {
  const hour = currentHourInTimeZone(now, timeZone)
  return hour >= 20 || hour < 8
}

/** Local hour 0–23 in the given IANA timezone. */
export function currentHourInTimeZone(
  now: Date = new Date(),
  timeZone: string = INBOUND_CAPTURE_TIMEZONE
): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(now)
    const hourPart = parts.find((p) => p.type === "hour")?.value
    const hour = Number(hourPart)
    if (Number.isFinite(hour)) return hour
  } catch {
    // Fall through to local system timezone.
  }
  return now.getHours()
}

/** Spoken night Gather — closed office + SMS default + emergency dial. */
export const NIGHT_CAPTURE_PROMPT =
  "Thanks for calling Key Squad 5-0-2. Our office is currently closed, but you can book your appointment right now on your phone. Press 1, or stay on the line, to receive an instant booking link via text message. If this is an absolute emergency, press 2 to ring our on-call line."

/** Spoken after day Dial times out unanswered. */
export const DAY_BUSY_FALLBACK_PROMPT =
  "Our representatives are currently assisting other clients. Press 1 to get a direct link texted to your mobile device to book your appointment instantly, or press 2 to remain on hold."

/** Presence Closed — office closed, booking link only. */
export const PRESENCE_CLOSED_PROMPT =
  "Thanks for calling Key Squad. We are currently closed, but you can still book online. Press 1 or stay on the line to receive a text link to reserve your spot instantly."

/** Presence On-Job — busy IVR + booking link. */
export const PRESENCE_ON_JOB_PROMPT =
  "We are currently on a job and cannot take your call right now. Press 1 to get an instant text link to view our remaining open booking slots."

/** Full-day calendar blockout — skip cell, SMS booking for tomorrow. */
export const CALENDAR_FULL_DAY_PROMPT =
  "Thanks for calling Key Squad. We are out of the office or fully booked today, but our schedule for tomorrow is wide open. Press 1 or stay on the line to receive a text link to reserve your spot instantly."

/** Partial calendar blockout (job / appointment) — skip cell, SMS open slots. */
export const CALENDAR_PARTIAL_BUSY_PROMPT =
  "We are currently tied up on a job or appointment right now, but our online booking tracker is live. Press 1 to get an instant text link to view our remaining open slots for this afternoon."

/** Day first-ring timeout (seconds) before busy Gather. */
export const DAY_CAPTURE_DIAL_TIMEOUT_SECONDS = 15

/** Default on-call / owner cell for emergency + day Dial. */
export const CAPTURE_DEFAULT_RING_E164 = "+15022602716"

/** Unified UI statuses written to call_logs.routed_to_name. */
export const CAPTURE_STATUS_NIGHT_LINK = "Missed - Sent Night Link"
export const CAPTURE_STATUS_DAY_LINK = "Missed - Sent Day Link"
export const CAPTURE_STATUS_EMERGENCY_ANSWERED = "Emergency Answered"
/** In-progress night Gather (before SMS / emergency). */
export const CAPTURE_STATUS_NIGHT_MENU = "Night Capture"
/** In-progress day busy Gather. */
export const CAPTURE_STATUS_DAY_BUSY = "Day Capture"
/** Full-day blockout Gather / SMS. */
export const CAPTURE_STATUS_CALENDAR_OFF = "Calendar Day Off"
export const CAPTURE_STATUS_FULL_DAY_LINK = "Missed - Sent Day Off Link"
/** Partial blockout Gather / SMS. */
export const CAPTURE_STATUS_CALENDAR_BUSY = "Calendar Busy"
export const CAPTURE_STATUS_BUSY_LINK = "Missed - Sent Busy Link"
/** Presence Closed / On-Job. */
export const CAPTURE_STATUS_PRESENCE_CLOSED = "Presence Closed"
export const CAPTURE_STATUS_CLOSED_LINK = "Missed - Sent Closed Link"
export const CAPTURE_STATUS_PRESENCE_ON_JOB = "Presence On-Job"
export const CAPTURE_STATUS_ON_JOB_LINK = "Missed - Sent On-Job Link"

export const CAPTURE_XML_CONTENT_TYPE = "text/xml; charset=utf-8"

function escapeTexml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export function buildCaptureSayHangupXml(sayText: string, voice = "alice"): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="${escapeTexml(voice)}">${escapeTexml(sayText)}</Say>` +
    `<Hangup/>` +
    `</Response>`
  )
}

export function buildCaptureHangupXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`
}

/** Night entry Gather — timeout / no digit → action posts without Digits (SMS). */
export function buildNightCaptureGatherXml(actionUrl: string, voice = "alice"): string {
  return buildSmsDefaultGatherXml(actionUrl, NIGHT_CAPTURE_PROMPT, voice)
}

/** Calendar / SMS-default Gather — Press 1 or stay on the line → SMS. */
export function buildSmsDefaultGatherXml(
  actionUrl: string,
  prompt: string,
  voice = "alice"
): string {
  const safeAction = escapeTexml(actionUrl)
  const safePrompt = escapeTexml(prompt.trim() || NIGHT_CAPTURE_PROMPT)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Gather numDigits="1" timeout="8" action="${safeAction}" method="POST">` +
    `<Say voice="${escapeTexml(voice)}">${safePrompt}</Say>` +
    `</Gather>` +
    `<Redirect method="POST">${safeAction}</Redirect>` +
    `</Response>`
  )
}

export function buildCalendarFullDayGatherXml(actionUrl: string, voice = "alice"): string {
  return buildSmsDefaultGatherXml(actionUrl, CALENDAR_FULL_DAY_PROMPT, voice)
}

export function buildCalendarPartialBusyGatherXml(actionUrl: string, voice = "alice"): string {
  return buildSmsDefaultGatherXml(actionUrl, CALENDAR_PARTIAL_BUSY_PROMPT, voice)
}

export function buildPresenceClosedGatherXml(actionUrl: string, voice = "alice"): string {
  return buildSmsDefaultGatherXml(actionUrl, PRESENCE_CLOSED_PROMPT, voice)
}

export function buildPresenceOnJobGatherXml(actionUrl: string, voice = "alice"): string {
  return buildSmsDefaultGatherXml(actionUrl, PRESENCE_ON_JOB_PROMPT, voice)
}

/** Day first ring — 15s Dial, then action URL for unanswered fallback. */
export function buildDayCaptureDialXml(opts: {
  ringE164: string
  actionUrl: string
  callerId?: string | null
  timeoutSeconds?: number
}): string {
  const timeout = opts.timeoutSeconds ?? DAY_CAPTURE_DIAL_TIMEOUT_SECONDS
  const safeAction = escapeTexml(opts.actionUrl)
  const safeNumber = escapeTexml(opts.ringE164.trim())
  const callerAttr =
    opts.callerId && opts.callerId.trim()
      ? ` callerId="${escapeTexml(opts.callerId.trim())}"`
      : ""
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Dial timeout="${timeout}" answerOnBridge="true"${callerAttr} action="${safeAction}" method="POST">` +
    `<Number>${safeNumber}</Number>` +
    `</Dial>` +
    `</Response>`
  )
}

/** Day unanswered → busy Gather (1 = SMS, 2 = hold / voicemail). */
export function buildDayBusyFallbackGatherXml(actionUrl: string, voice = "alice"): string {
  const safeAction = escapeTexml(actionUrl)
  const safePrompt = escapeTexml(DAY_BUSY_FALLBACK_PROMPT)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Gather numDigits="1" timeout="8" action="${safeAction}" method="POST">` +
    `<Say voice="${escapeTexml(voice)}">${safePrompt}</Say>` +
    `</Gather>` +
    // Timeout = SMS (same as Press 1).
    `<Redirect method="POST">${safeAction}</Redirect>` +
    `</Response>`
  )
}

/** Press 2 day hold — short voice memo then hangup. */
export function buildDayHoldVoicemailXml(recordingCallbackUrl: string, voice = "alice"): string {
  const safeCb = escapeTexml(recordingCallbackUrl)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="${escapeTexml(voice)}">Please leave a short message after the beep and we will get back to you. Press pound when you are finished.</Say>` +
    `<Record maxLength="90" playBeep="true" finishOnKey="#" action="${safeCb}" method="POST"/>` +
    `<Say voice="${escapeTexml(voice)}">Thank you. Goodbye.</Say>` +
    `<Hangup/>` +
    `</Response>`
  )
}

/** True when Dial status means nobody took the call. */
export function isCaptureDialUnanswered(statusRaw: string): boolean {
  const s = statusRaw.trim().toLowerCase().replace(/_/g, "-")
  return (
    s === "no-answer" ||
    s === "busy" ||
    s === "failed" ||
    s === "canceled" ||
    s === "cancelled" ||
    s === "timeout" ||
    s === "unanswered" ||
    s === ""
  )
}

/** Night/day/calendar SMS + menu labels count as automated (never green Answered). */
export function isCaptureMissedLinkStatus(routedToName: string | null | undefined): boolean {
  const n = String(routedToName ?? "").trim()
  return (
    n === CAPTURE_STATUS_NIGHT_LINK ||
    n === CAPTURE_STATUS_DAY_LINK ||
    n === CAPTURE_STATUS_NIGHT_MENU ||
    n === CAPTURE_STATUS_DAY_BUSY ||
    n === CAPTURE_STATUS_CALENDAR_OFF ||
    n === CAPTURE_STATUS_FULL_DAY_LINK ||
    n === CAPTURE_STATUS_CALENDAR_BUSY ||
    n === CAPTURE_STATUS_BUSY_LINK ||
    n === CAPTURE_STATUS_PRESENCE_CLOSED ||
    n === CAPTURE_STATUS_CLOSED_LINK ||
    n === CAPTURE_STATUS_PRESENCE_ON_JOB ||
    n === CAPTURE_STATUS_ON_JOB_LINK
  )
}

export function isCaptureEmergencyAnswered(routedToName: string | null | undefined): boolean {
  return String(routedToName ?? "").trim() === CAPTURE_STATUS_EMERGENCY_ANSWERED
}

export type InboundCapturePlan =
  | {
      kind: "presence_closed"
    }
  | {
      kind: "presence_on_job"
    }
  | {
      kind: "calendar_full_day"
      dateKey: string
      timeHhMm: string
      reason: string | null
    }
  | {
      kind: "calendar_partial"
      dateKey: string
      timeHhMm: string
      reason: string | null
    }
  | { kind: "day_dial" }

/**
 * Presence + calendar drive ring vs SMS (no rigid night clock).
 * CLOSED or any active blockout → no cell ring.
 * ON_JOB → busy IVR + booking link.
 * AVAILABLE (no blockout) → 15s Dial then SMS fallback.
 */
export async function resolveInboundCapturePlan(params: {
  ownerUserId: string | null
  now?: Date
  timeZone?: string
}): Promise<InboundCapturePlan> {
  const now = params.now ?? new Date()
  const timeZone = params.timeZone ?? INBOUND_CAPTURE_TIMEZONE

  let presenceStatus: "AVAILABLE" | "ON_JOB" | "CLOSED" = "AVAILABLE"
  if (params.ownerUserId) {
    try {
      presenceStatus = (await getAccountPresence(params.ownerUserId)).presenceStatus
    } catch (e) {
      console.warn("[inbound-capture] presence lookup skipped:", e)
    }
  }

  // Manual Closed always wins — never ring.
  if (presenceStatus === "CLOSED") {
    return { kind: "presence_closed" }
  }

  if (params.ownerUserId) {
    try {
      const { dateKey } = localDateTimePartsInZone(now, timeZone)
      const blockouts = await listScheduleBlockoutsForDate({
        ownerUserId: params.ownerUserId,
        dateKey,
      })
      const override = resolveInboundCalendarOverride(blockouts, now, timeZone)
      if (override?.kind === "full_day") {
        return {
          kind: "calendar_full_day",
          dateKey: override.dateKey,
          timeHhMm: override.timeHhMm,
          reason: override.blockout.reason,
        }
      }
      if (override?.kind === "partial") {
        return {
          kind: "calendar_partial",
          dateKey: override.dateKey,
          timeHhMm: override.timeHhMm,
          reason: override.blockout.reason,
        }
      }
    } catch (e) {
      console.warn("[inbound-capture] calendar lookup skipped:", e)
    }
  }

  if (presenceStatus === "ON_JOB") {
    return { kind: "presence_on_job" }
  }

  return { kind: "day_dial" }
}
