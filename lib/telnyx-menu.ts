// Telnyx traditional IVR menu helpers — Gather, SMS booking link, Dial + unanswered fallback.
// Digit-2 ring target is resolved dynamically via findActiveOperatorForAccount
// (AVAILABLE RECEPTIONIST → OWNER) in app/api/telnyx-menu/route.ts — never hardcode a cell here.

import { defaultIntakeScheduleDate, suggestNextOpenTime, combineDateAndTime } from "@/lib/intake-schedule-helpers"
import type { ScheduleBlockout, SchedulerEvent } from "@/lib/types"
import { cleanTextForTTS } from "@/lib/texml-say-voice"

/** Default Gather menu — Key Squad multi-step IVR. */
export const TELNYX_MENU_PROMPT =
  "Thanks for calling Key Squad 502. Press 1 to book on your phone without talking to anyone, or Press 2 to ring our phone."

/**
 * Spoken when the active line's presence_status is ON_JOB.
 * Used by /api/telnyx-menu calendar-aware entry (via buildPresenceOnJobGatherXml).
 */
export const TELNYX_MENU_ON_JOB_PROMPT =
  "Thanks for calling Key Squad. We're actively on a live lockout service right now, but we are open. Press 1 to get our next open dispatch slot text straight to your device, or stay on the line."

/**
 * Spoken when the active line's presence_status is CLOSED.
 * Used by /api/telnyx-menu calendar-aware entry (via buildPresenceClosedGatherXml).
 */
export const TELNYX_MENU_CLOSED_PROMPT =
  "Thanks for calling Key Squad. Our mobile technicians are currently off-duty for the evening. You can book a priority appointment slot for tomorrow morning by pressing 1, or leave a voicemail."

/**
 * Pick the initial IVR <Say> greeting from presence_status.
 * Optional custom scripts (from account_settings) override product defaults.
 */
export function resolveTelnyxMenuGreetingForPresence(
  presenceStatus: "AVAILABLE" | "ON_JOB" | "CLOSED" | string | null | undefined,
  custom?: {
    onJobGreetingText?: string | null
    closedGreetingText?: string | null
  }
): string {
  // Normalize whatever the DB or UI sent into a comparable uppercase token.
  const status = String(presenceStatus || "")
    .trim()
    .toUpperCase()
  // Live lockout — still open, offer next dispatch slot by text.
  if (status === "ON_JOB") {
    const customText =
      typeof custom?.onJobGreetingText === "string" ? custom.onJobGreetingText.trim() : ""
    return customText || TELNYX_MENU_ON_JOB_PROMPT
  }
  // Off-duty evening — tomorrow priority slot or voicemail.
  if (status === "CLOSED") {
    const customText =
      typeof custom?.closedGreetingText === "string" ? custom.closedGreetingText.trim() : ""
    return customText || TELNYX_MENU_CLOSED_PROMPT
  }
  // Open / unknown — standard press-1 / press-2 menu.
  return TELNYX_MENU_PROMPT
}

/** Spoken after unanswered / busy / timed-out Dial to the owner cell. */
export const TELNYX_MENU_BUSY_FALLBACK_PROMPT =
  "Our phones are busy today but our online booking is still available. Press 1 to receive a link."

/** Default owner cell for Digits=2 Dial when routing has no owner phone. */
export const TELNYX_MENU_DEFAULT_RING_E164 = "+15022602716"

/** Ring timeout (seconds) on Digits=2 before unanswered fallback. */
export const TELNYX_MENU_DIAL_TIMEOUT_SECONDS = 20

/** TeXML Content-Type for Gather action callbacks. */
export const TELNYX_MENU_XML_CONTENT_TYPE = "text/xml; charset=utf-8"

export function escapeTexmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** Escape spoken <Say> text after phonetic TTS cleanup (502 → five oh two). */
export function escapeTexmlSayText(value: string): string {
  return escapeTexmlText(cleanTextForTTS(value))
}

/** Secure booking deep-link SMS body — prefers opaque /book/[id] tracking URLs. */
export function buildTelnyxMenuBookingSms(
  fromE164: string,
  bookUrlOrBase = "https://lyncr.app/book",
  businessLineE164?: string | null
): string {
  const trimmed = bookUrlOrBase.trim()
  // Already a full /book/<uuid> (or other absolute) tracking link.
  if (/^https?:\/\/.+/i.test(trimmed) && /\/book\/[^/?#]+/i.test(trimmed)) {
    return `Here is your secure booking link: ${trimmed}`
  }

  const phone = encodeURIComponent(fromE164.trim())
  const lineQs =
    businessLineE164 && businessLineE164.trim()
      ? `&line=${encodeURIComponent(businessLineE164.trim())}`
      : ""
  const link = `${trimmed.replace(/\/+$/, "")}?phone=${phone}${lineQs}`
  return `Here is your secure booking link to lock in your spot: ${link}`
}

/** Raw TeXML: polite hangup after SMS / reservation success. */
export function buildTelnyxMenuSayHangupXml(sayText: string, voice = "alice"): string {
  const safe = escapeTexmlSayText(sayText)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="${escapeTexmlText(voice)}">${safe}</Say>` +
    `<Hangup/>` +
    `</Response>`
  )
}

/** Empty hangup — used when the Dial leg already connected and the call is ending. */
export function buildTelnyxMenuHangupXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`
}

/** Invalid keypress → announce and Redirect back to the menu Gather URL. */
export function buildTelnyxMenuInvalidRedirectXml(menuUrl: string, voice = "alice"): string {
  const safeUrl = escapeTexmlText(menuUrl)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="${escapeTexmlText(voice)}">Invalid option.</Say>` +
    `<Redirect method="POST">${safeUrl}</Redirect>` +
    `</Response>`
  )
}

/** Entry Gather that posts Digits back to the same menu action URL. */
export function buildTelnyxMenuGatherXml(
  actionUrl: string,
  greetingText: string = TELNYX_MENU_PROMPT,
  voice = "alice"
): string {
  const safeAction = escapeTexmlText(actionUrl)
  const safePrompt = escapeTexmlSayText(greetingText.trim() || TELNYX_MENU_PROMPT)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Gather numDigits="1" timeout="8" action="${safeAction}" method="POST">` +
    `<Say voice="${escapeTexmlText(voice)}">${safePrompt}</Say>` +
    `</Gather>` +
    `<Say voice="${escapeTexmlText(voice)}">We did not receive a selection. Goodbye.</Say>` +
    `<Hangup/>` +
    `</Response>`
  )
}

/** Digits=2 — Dial the owner cell; unanswered / busy / timeout posts to `actionUrl`. */
export function buildTelnyxMenuDialXml(opts: {
  ringE164: string
  actionUrl: string
  callerId?: string | null
  timeoutSeconds?: number
}): string {
  const timeout = opts.timeoutSeconds ?? TELNYX_MENU_DIAL_TIMEOUT_SECONDS
  const safeAction = escapeTexmlText(opts.actionUrl)
  const safeNumber = escapeTexmlText(opts.ringE164.trim())
  const callerAttr =
    opts.callerId && opts.callerId.trim()
      ? ` callerId="${escapeTexmlText(opts.callerId.trim())}"`
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

/** Unanswered Dial → offer SMS booking link again. */
export function buildTelnyxMenuBusyFallbackGatherXml(
  actionUrl: string,
  prompt: string = TELNYX_MENU_BUSY_FALLBACK_PROMPT,
  voice = "alice"
): string {
  const safeAction = escapeTexmlText(actionUrl)
  const safePrompt = escapeTexmlSayText(prompt.trim() || TELNYX_MENU_BUSY_FALLBACK_PROMPT)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Gather numDigits="1" timeout="8" action="${safeAction}" method="POST">` +
    `<Say voice="${escapeTexmlText(voice)}">${safePrompt}</Say>` +
    `</Gather>` +
    `<Say voice="${escapeTexmlText(voice)}">Goodbye.</Say>` +
    `<Hangup/>` +
    `</Response>`
  )
}

/** Digit action → traditional voicemail record. */
export function buildTelnyxMenuVoicemailXml(
  recordingCallbackUrl: string,
  voice = "alice"
): string {
  const safeCb = escapeTexmlText(recordingCallbackUrl)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="${escapeTexmlText(voice)}">Please leave a message after the beep. Press pound when you are finished.</Say>` +
    `<Record maxLength="120" playBeep="true" finishOnKey="#" action="${safeCb}" method="POST"/>` +
    `<Say voice="${escapeTexmlText(voice)}">Thank you. Goodbye.</Say>` +
    `<Hangup/>` +
    `</Response>`
  )
}

/** True when Dial status means the owner never took the call. */
export function isTelnyxMenuDialUnanswered(statusRaw: string): boolean {
  const s = statusRaw.trim().toLowerCase().replace(/_/g, "-")
  return (
    s === "no-answer" ||
    s === "busy" ||
    s === "failed" ||
    s === "canceled" ||
    s === "cancelled" ||
    s === "timeout" ||
    s === "unanswered"
  )
}

/** Local midnight Date for “tomorrow” relative to `now`. */
export function tomorrowLocalMidnight(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
}

/**
 * Earliest open 1-hour block on tomorrow’s calendar day (7am–7pm grid).
 * Returns null when tomorrow is fully booked.
 */
export function getEarliestOpenBlockTomorrow(
  events: readonly SchedulerEvent[],
  now = new Date(),
  blockouts: readonly ScheduleBlockout[] = []
): { dateKey: string; timeValue: string; localDateTime: string; scheduledAtIso: string; text: string } | null {
  const tomorrow = tomorrowLocalMidnight(now)
  const dateKey = defaultIntakeScheduleDate(tomorrow)
  const timeValue = suggestNextOpenTime([...events], dateKey, 60, null, null, 7, 19, blockouts)
  if (!timeValue) return null

  const localDateTime = combineDateAndTime(dateKey, timeValue)
  const scheduledAt = new Date(localDateTime)
  if (Number.isNaN(scheduledAt.getTime())) return null

  const [hourRaw, minuteRaw] = timeValue.split(":").map(Number)
  const hour = Number.isFinite(hourRaw) ? hourRaw : 9
  const minute = Number.isFinite(minuteRaw) ? minuteRaw : 0
  const suffix = hour >= 12 ? "PM" : "AM"
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  const minuteLabel = minute === 0 ? ":00" : `:${String(minute).padStart(2, "0")}`
  const text = `Tomorrow at ${displayHour}${minuteLabel} ${suffix}`

  return {
    dateKey,
    timeValue,
    localDateTime,
    scheduledAtIso: scheduledAt.toISOString(),
    text,
  }
}

export const TELNYX_MENU_DIGIT1_SAY =
  "Perfect, we just texted that link to your phone number. Goodbye!"

export const TELNYX_MENU_DIGIT2_SAY =
  "Success! We have registered your phone number for our earliest priority slot tomorrow morning. A dispatcher will call you first thing to confirm. Goodbye!"
