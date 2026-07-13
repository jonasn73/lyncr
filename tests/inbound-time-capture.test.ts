import { describe, expect, it } from "vitest"
import {
  CAPTURE_STATUS_DAY_LINK,
  CAPTURE_STATUS_EMERGENCY_ANSWERED,
  CAPTURE_STATUS_NIGHT_LINK,
  DAY_CAPTURE_DIAL_TIMEOUT_SECONDS,
  NIGHT_CAPTURE_PROMPT,
  DAY_BUSY_FALLBACK_PROMPT,
  CALENDAR_FULL_DAY_PROMPT,
  CALENDAR_PARTIAL_BUSY_PROMPT,
  buildCalendarFullDayGatherXml,
  buildCalendarPartialBusyGatherXml,
  buildDayBusyFallbackGatherXml,
  buildDayCaptureDialXml,
  buildNightCaptureGatherXml,
  currentHourInTimeZone,
  isCaptureDialUnanswered,
  isCaptureMissedLinkStatus,
  isNightMode,
} from "@/lib/inbound-time-capture"
import {
  formatCaptureRoutedStatus,
  isAutomatedCallHandler,
  isMissedCallRecord,
  ownerLiveAnswered,
} from "@/lib/missed-call-telemetry"

describe("inbound time capture", () => {
  it("treats 8 PM – 7:59 AM Eastern as night mode", () => {
    // 2026-07-13 20:00 EDT = midnight UTC Jul 14? EDT is UTC-4 → 20:00 EDT = 00:00 UTC Jul 14
    const eightPmEt = new Date("2026-07-14T00:00:00.000Z")
    expect(currentHourInTimeZone(eightPmEt, "America/New_York")).toBe(20)
    expect(isNightMode(eightPmEt)).toBe(true)

    const sevenAmEt = new Date("2026-07-13T11:00:00.000Z") // 7 AM EDT
    expect(currentHourInTimeZone(sevenAmEt, "America/New_York")).toBe(7)
    expect(isNightMode(sevenAmEt)).toBe(true)

    const nineAmEt = new Date("2026-07-13T13:00:00.000Z") // 9 AM EDT
    expect(currentHourInTimeZone(nineAmEt, "America/New_York")).toBe(9)
    expect(isNightMode(nineAmEt)).toBe(false)

    const sevenPmEt = new Date("2026-07-13T23:00:00.000Z") // 7 PM EDT
    expect(isNightMode(sevenPmEt)).toBe(false)
  })

  it("builds night Gather with closed-office prompt and Redirect default", () => {
    const xml = buildNightCaptureGatherXml("https://lyncr.app/api/telnyx-capture?step=night")
    expect(xml).toContain("<Gather")
    expect(xml).toContain(NIGHT_CAPTURE_PROMPT)
    expect(xml).toContain('action="https://lyncr.app/api/telnyx-capture?step=night"')
    expect(xml).toContain("<Redirect")
  })

  it("builds day Dial with 15s timeout", () => {
    const xml = buildDayCaptureDialXml({
      ringE164: "+15022602716",
      actionUrl: "https://lyncr.app/api/telnyx-capture?step=day-fallback",
      callerId: "+15027843047",
    })
    expect(xml).toContain(`timeout="${DAY_CAPTURE_DIAL_TIMEOUT_SECONDS}"`)
    expect(xml).toContain("+15022602716")
    expect(xml).toContain("day-fallback")
  })

  it("builds day busy Gather prompt", () => {
    const xml = buildDayBusyFallbackGatherXml("https://lyncr.app/api/telnyx-capture?step=day-busy")
    expect(xml).toContain(DAY_BUSY_FALLBACK_PROMPT)
    expect(xml).toContain("<Redirect")
  })

  it("classifies dial statuses", () => {
    expect(isCaptureDialUnanswered("no-answer")).toBe(true)
    expect(isCaptureDialUnanswered("busy")).toBe(true)
    expect(isCaptureDialUnanswered("completed")).toBe(false)
  })

  it("builds calendar full-day and partial busy Gather prompts", () => {
    const full = buildCalendarFullDayGatherXml("https://lyncr.app/api/telnyx-capture?step=calendar-off")
    // TeXML escapes apostrophes (We're → We&apos;re) — match unescaped fragments.
    expect(full).toContain("tied up on a service job")
    expect(full).toContain("calendar-off")
    expect(CALENDAR_FULL_DAY_PROMPT).toContain("tied up")

    const partial = buildCalendarPartialBusyGatherXml(
      "https://lyncr.app/api/telnyx-capture?step=calendar-busy"
    )
    expect(partial).toContain("tied up on a service job")
    expect(partial).toContain("calendar-busy")
    expect(CALENDAR_PARTIAL_BUSY_PROMPT).toContain("tied up")
  })
})

describe("capture status telemetry", () => {
  it("marks night/day link statuses as missed automated", () => {
    expect(isCaptureMissedLinkStatus(CAPTURE_STATUS_NIGHT_LINK)).toBe(true)
    expect(isCaptureMissedLinkStatus(CAPTURE_STATUS_DAY_LINK)).toBe(true)
    expect(isAutomatedCallHandler(CAPTURE_STATUS_NIGHT_LINK)).toBe(true)
    expect(isMissedCallRecord({ routed_to_name: CAPTURE_STATUS_NIGHT_LINK, call_type: "missed" })).toBe(
      true
    )
    expect(formatCaptureRoutedStatus(CAPTURE_STATUS_DAY_LINK)).toBe("Missed - Sent Day Link")
  })

  it("treats Emergency Answered as a live answer when bridged", () => {
    expect(isAutomatedCallHandler(CAPTURE_STATUS_EMERGENCY_ANSWERED)).toBe(false)
    expect(
      ownerLiveAnswered({
        routed_to_name: CAPTURE_STATUS_EMERGENCY_ANSWERED,
        answered_at: "2026-07-13T02:00:00.000Z",
        status: "completed",
        duration_seconds: 40,
      })
    ).toBe(true)
    expect(
      isMissedCallRecord({
        routed_to_name: CAPTURE_STATUS_EMERGENCY_ANSWERED,
        answered_at: "2026-07-13T02:00:00.000Z",
        status: "completed",
        duration_seconds: 40,
      })
    ).toBe(false)
  })
})
