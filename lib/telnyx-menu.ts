// Telnyx traditional IVR menu helpers — Digits gather, SMS booking link, tomorrow slot hold.

import { defaultIntakeScheduleDate, suggestNextOpenTime, combineDateAndTime } from "@/lib/intake-schedule-helpers"
import type { SchedulerEvent } from "@/lib/types"

/** Default Gather menu copy for the IVR entry point. */
export const TELNYX_MENU_PROMPT =
  "Welcome to Lyncr booking. Press 1 to receive a secure booking link by text. Press 2 to reserve our earliest priority slot tomorrow morning."

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

/** Secure booking deep-link SMS body (phone substituted into the query string). */
export function buildTelnyxMenuBookingSms(fromE164: string, bookBaseUrl = "https://lyncr.app/book"): string {
  const phone = encodeURIComponent(fromE164.trim())
  const link = `${bookBaseUrl.replace(/\/+$/, "")}?phone=${phone}`
  return `Here is your secure booking link to lock in your spot for tomorrow: ${link}`
}

/** Raw TeXML: polite hangup after SMS / reservation success. */
export function buildTelnyxMenuSayHangupXml(sayText: string, voice = "alice"): string {
  const safe = escapeTexmlText(sayText)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="${escapeTexmlText(voice)}">${safe}</Say>` +
    `<Hangup/>` +
    `</Response>`
  )
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
  const safePrompt = escapeTexmlText(greetingText.trim() || TELNYX_MENU_PROMPT)
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
  now = new Date()
): { dateKey: string; timeValue: string; localDateTime: string; scheduledAtIso: string; text: string } | null {
  const tomorrow = tomorrowLocalMidnight(now)
  const dateKey = defaultIntakeScheduleDate(tomorrow)
  const timeValue = suggestNextOpenTime([...events], dateKey, 60, null, null, 7, 19)
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
