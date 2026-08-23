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
  isCaptureDialLiveHumanBridge,
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


/** Mirrors the <Say> escaping in lib/inbound-time-capture.ts. Asserting against the
 *  exported prompt constants (rather than copies of the wording) keeps these tests from
 *  going stale every time the script is reworded. */
const texmlEscape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")

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
    // TTS rewrites "502" → "five oh two" inside <Say>; match stable fragments.
    expect(xml).toContain("Our office is currently closed")
    expect(xml).toContain("five oh two")
    expect(NIGHT_CAPTURE_PROMPT).toContain("Key Squad 502")
    expect(xml).toContain('action="https://lyncr.app/api/telnyx-capture?step=night"')
    expect(xml).toContain("<Redirect")
  })

  it("builds day Dial with ringback, configurable timeout, and optional answer url", () => {
    const xml = buildDayCaptureDialXml({
      ringE164: "+15022602716",
      actionUrl: "https://lyncr.app/api/telnyx-capture?step=day-fallback",
      callerId: "+15027843047",
    })
    expect(xml).toContain(`timeout="${DAY_CAPTURE_DIAL_TIMEOUT_SECONDS}"`)
    expect(xml).toContain("+15022602716")
    expect(xml).toContain("day-fallback")
    // Caller must hear US ringback while answerOnBridge waits for the cell.
    expect(xml).toContain('ringTone="us"')
    expect(xml).toContain('answerOnBridge="true"')

    const withAnswer = buildDayCaptureDialXml({
      ringE164: "+15022602716",
      actionUrl: "https://lyncr.app/api/telnyx-capture?step=day-fallback",
      timeoutSeconds: 30,
      numberUrl: "https://lyncr.app/api/voice/telnyx/receptionist-answer?u=abc",
    })
    expect(withAnswer).toContain('timeout="30"')
    expect(withAnswer).toContain("receptionist-answer")
    expect(withAnswer).toContain('method="POST"')
    expect(withAnswer).toContain('ringTone="us"')
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

  it("treats answered + talk time as a live bridge without press-1", () => {
    // Short completed with no answered_at and no talk — not live (busy Gather).
    expect(
      isCaptureDialLiveHumanBridge({
        dialStatus: "completed",
        answeredAt: null,
        dialCallDurationSec: 2,
        dialBridgedDurationSec: 0,
        dialBridgedTo: "",
      })
    ).toBe(false)

    // Owner answer webhook stamps answered_at on immediate bridge → hang up after talk.
    expect(
      isCaptureDialLiveHumanBridge({
        dialStatus: "completed",
        answeredAt: "2026-07-27T20:18:20.289Z",
        dialCallDurationSec: 21,
      })
    ).toBe(true)

    // No answered_at but enough talk seconds → treat as live (best-effort).
    expect(
      isCaptureDialLiveHumanBridge({
        dialStatus: "completed",
        answeredAt: null,
        dialCallDurationSec: 45,
        dialBridgedDurationSec: 0,
        dialBridgedTo: "",
      })
    ).toBe(true)

    // Bridge metadata + enough talk seconds → live.
    expect(
      isCaptureDialLiveHumanBridge({
        dialStatus: "completed",
        answeredAt: null,
        dialCallDurationSec: 45,
        dialBridgedDurationSec: 40,
        dialBridgedTo: "+15022602716",
      })
    ).toBe(true)

    // no-answer must never count as live.
    expect(
      isCaptureDialLiveHumanBridge({
        dialStatus: "no-answer",
        answeredAt: null,
        dialCallDurationSec: 15,
      })
    ).toBe(false)
  })

  it("builds calendar full-day and partial busy Gather prompts", () => {
    const full = buildCalendarFullDayGatherXml("https://lyncr.app/api/telnyx-capture?step=calendar-off")
    expect(full).toContain(texmlEscape(CALENDAR_FULL_DAY_PROMPT))
    expect(full).toContain("calendar-off")

    const partial = buildCalendarPartialBusyGatherXml(
      "https://lyncr.app/api/telnyx-capture?step=calendar-busy"
    )
    expect(partial).toContain(texmlEscape(CALENDAR_PARTIAL_BUSY_PROMPT))
    expect(partial).toContain("calendar-busy")
    // Full-day and partial blockouts intentionally share one script.
    expect(CALENDAR_FULL_DAY_PROMPT).toBe(CALENDAR_PARTIAL_BUSY_PROMPT)
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
