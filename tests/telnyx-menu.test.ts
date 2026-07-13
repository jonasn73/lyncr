import { describe, expect, it } from "vitest"
import {
  TELNYX_MENU_BUSY_FALLBACK_PROMPT,
  TELNYX_MENU_CLOSED_PROMPT,
  TELNYX_MENU_DEFAULT_RING_E164,
  TELNYX_MENU_DIGIT1_SAY,
  TELNYX_MENU_DIGIT2_SAY,
  TELNYX_MENU_DIAL_TIMEOUT_SECONDS,
  TELNYX_MENU_ON_JOB_PROMPT,
  TELNYX_MENU_PROMPT,
  buildTelnyxMenuBookingSms,
  buildTelnyxMenuBusyFallbackGatherXml,
  buildTelnyxMenuDialXml,
  buildTelnyxMenuGatherXml,
  buildTelnyxMenuHangupXml,
  buildTelnyxMenuInvalidRedirectXml,
  buildTelnyxMenuSayHangupXml,
  getEarliestOpenBlockTomorrow,
  isTelnyxMenuDialUnanswered,
  resolveTelnyxMenuGreetingForPresence,
  tomorrowLocalMidnight,
} from "@/lib/telnyx-menu"
import { combineDateAndTime } from "@/lib/intake-schedule-helpers"
import type { SchedulerEvent } from "@/lib/types"

function eventAt(id: string, localDateTime: string): SchedulerEvent {
  return {
    id,
    customer_name: id,
    customer_phone: null,
    location: null,
    summary: null,
    disposition: "BOOKED",
    scheduled_at: new Date(localDateTime).toISOString(),
    scheduled_tentative: false,
    created_at: new Date(localDateTime).toISOString(),
    job_type: "Lockout",
    duration_minutes: 60,
    assigned_tech_id: null,
    assigned_tech_name: null,
    vehicle_year: null,
    vehicle_make: null,
    vehicle_model: null,
    job_notes: null,
    latitude: null,
    longitude: null,
    job_status: null,
    dispatch_status: null,
  }
}

describe("telnyx menu IVR helpers", () => {
  it("builds Digits=1 SMS with the From phone in the booking link", () => {
    const sms = buildTelnyxMenuBookingSms("+15025550100")
    expect(sms).toContain("https://lyncr.app/book?phone=%2B15025550100")
    expect(sms).toContain("secure booking link")
  })

  it("builds Digits=1 SMS from an opaque /book/[id] tracking URL", () => {
    const sms = buildTelnyxMenuBookingSms(
      "+15025550100",
      "https://lyncr.app/book/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    )
    expect(sms).toContain("https://lyncr.app/book/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    expect(sms).not.toContain("phone=")
  })

  it("builds Digits=1 / Digits=2 Say+Hangup TeXML with alice voice", () => {
    const xml1 = buildTelnyxMenuSayHangupXml(TELNYX_MENU_DIGIT1_SAY)
    expect(xml1).toContain('voice="alice"')
    expect(xml1).toContain("Perfect, we just texted that link")
    expect(xml1).toContain("<Hangup/>")

    const xml2 = buildTelnyxMenuSayHangupXml(TELNYX_MENU_DIGIT2_SAY)
    expect(xml2).toContain("earliest priority slot tomorrow morning")
    expect(xml2).toContain("<Hangup/>")
  })

  it("builds invalid-option Redirect back to the menu URL", () => {
    const xml = buildTelnyxMenuInvalidRedirectXml("https://lyncr.app/api/telnyx-menu")
    expect(xml).toContain("Invalid option")
    expect(xml).toContain("<Redirect method=\"POST\">https://lyncr.app/api/telnyx-menu</Redirect>")
  })

  it("builds the Gather entry menu with Key Squad press-1 / press-2 copy", () => {
    const xml = buildTelnyxMenuGatherXml("https://lyncr.app/api/telnyx-menu")
    expect(xml).toContain("<Gather")
    expect(xml).toContain('action="https://lyncr.app/api/telnyx-menu"')
    expect(xml).toContain("Press 1")
    expect(xml).toContain("Press 2")
    expect(xml).toContain("Key Squad 5-0-2")
    expect(TELNYX_MENU_PROMPT).toContain("ring our phone")
  })

  it("resolves distinct Speak greetings for ON_JOB vs CLOSED presence", () => {
    expect(resolveTelnyxMenuGreetingForPresence("ON_JOB")).toBe(TELNYX_MENU_ON_JOB_PROMPT)
    expect(resolveTelnyxMenuGreetingForPresence("CLOSED")).toBe(TELNYX_MENU_CLOSED_PROMPT)
    expect(resolveTelnyxMenuGreetingForPresence("AVAILABLE")).toBe(TELNYX_MENU_PROMPT)
    expect(TELNYX_MENU_ON_JOB_PROMPT).toContain("live lockout service")
    expect(TELNYX_MENU_CLOSED_PROMPT).toContain("off-duty for the evening")
    expect(TELNYX_MENU_ON_JOB_PROMPT).not.toBe(TELNYX_MENU_CLOSED_PROMPT)
  })

  it("builds Digits=2 Dial with 20s timeout and unanswered action URL", () => {
    const xml = buildTelnyxMenuDialXml({
      ringE164: TELNYX_MENU_DEFAULT_RING_E164,
      actionUrl: "https://lyncr.app/api/telnyx-menu?step=dial-fallback",
      callerId: "+15027843047",
      timeoutSeconds: TELNYX_MENU_DIAL_TIMEOUT_SECONDS,
    })
    expect(xml).toContain(`timeout="${TELNYX_MENU_DIAL_TIMEOUT_SECONDS}"`)
    expect(xml).toContain(TELNYX_MENU_DEFAULT_RING_E164)
    expect(xml).toContain('action="https://lyncr.app/api/telnyx-menu?step=dial-fallback"')
    expect(xml).toContain('callerId="+15027843047"')
  })

  it("builds busy-fallback Gather prompting for an SMS link", () => {
    const xml = buildTelnyxMenuBusyFallbackGatherXml(
      "https://lyncr.app/api/telnyx-menu?step=busy-gather"
    )
    expect(xml).toContain(TELNYX_MENU_BUSY_FALLBACK_PROMPT)
    expect(xml).toContain('action="https://lyncr.app/api/telnyx-menu?step=busy-gather"')
    expect(xml).toContain("<Hangup/>")
  })

  it("classifies Dial statuses as unanswered vs connected", () => {
    expect(isTelnyxMenuDialUnanswered("no-answer")).toBe(true)
    expect(isTelnyxMenuDialUnanswered("busy")).toBe(true)
    expect(isTelnyxMenuDialUnanswered("failed")).toBe(true)
    expect(isTelnyxMenuDialUnanswered("completed")).toBe(false)
    expect(isTelnyxMenuDialUnanswered("answered")).toBe(false)
    expect(buildTelnyxMenuHangupXml()).toContain("<Hangup/>")
  })

  it("finds the earliest open block tomorrow when 9am is taken", () => {
    const now = new Date(2026, 6, 13, 15, 0, 0, 0) // Mon Jul 13
    const tomorrow = tomorrowLocalMidnight(now)
    const y = tomorrow.getFullYear()
    const m = String(tomorrow.getMonth() + 1).padStart(2, "0")
    const d = String(tomorrow.getDate()).padStart(2, "0")
    const dateKey = `${y}-${m}-${d}`
    const events = [eventAt("busy", combineDateAndTime(dateKey, "09:00"))]
    const slot = getEarliestOpenBlockTomorrow(events, now)
    expect(slot).not.toBeNull()
    expect(slot?.dateKey).toBe(dateKey)
    expect(slot?.timeValue).not.toBe("09:00")
    expect(slot?.text).toMatch(/^Tomorrow at /)
  })
})
