// Time-based inbound capture — night sleep protection + day busy fallback.
// Timezone: America/New_York (Eastern). Night = 8 PM – 8 AM local.

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
  const safeAction = escapeTexml(actionUrl)
  const safePrompt = escapeTexml(NIGHT_CAPTURE_PROMPT)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Gather numDigits="1" timeout="8" action="${safeAction}" method="POST">` +
    `<Say voice="${escapeTexml(voice)}">${safePrompt}</Say>` +
    `</Gather>` +
    // Stay-on-the-line default: redirect so the same handler sends SMS.
    `<Redirect method="POST">${safeAction}</Redirect>` +
    `</Response>`
  )
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

/** Night/day SMS + menu labels count as automated (never green Answered). */
export function isCaptureMissedLinkStatus(routedToName: string | null | undefined): boolean {
  const n = String(routedToName ?? "").trim()
  return (
    n === CAPTURE_STATUS_NIGHT_LINK ||
    n === CAPTURE_STATUS_DAY_LINK ||
    n === CAPTURE_STATUS_NIGHT_MENU ||
    n === CAPTURE_STATUS_DAY_BUSY
  )
}

export function isCaptureEmergencyAnswered(routedToName: string | null | undefined): boolean {
  return String(routedToName ?? "").trim() === CAPTURE_STATUS_EMERGENCY_ANSWERED
}
