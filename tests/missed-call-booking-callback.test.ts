import { describe, expect, it } from "vitest"
import {
  bookingLinkSmsToneFromSource,
  isMissedCallBookingCallbackMode,
} from "@/lib/booking-sms-guards"
import { buildBookQueryUrl } from "@/lib/booking-invite"

describe("missed-call booking callback mode", () => {
  it("flags missed sources as callback form (not slot pick)", () => {
    expect(isMissedCallBookingCallbackMode("missed_call_textback")).toBe(true)
    expect(isMissedCallBookingCallbackMode("missed_call_rescue_resend")).toBe(true)
    expect(isMissedCallBookingCallbackMode("missed_lead_banner")).toBe(true)
    expect(bookingLinkSmsToneFromSource("missed_call_activity")).toBe("missed_call")
  })

  it("keeps plain IVR / follow-up sources off missed-call callback mode (deposit may apply)", () => {
    // UI is now ASAP/window for all /book/[id] invites; this flag only skips deposit.
    expect(isMissedCallBookingCallbackMode("ivr")).toBe(false)
    expect(isMissedCallBookingCallbackMode("on_call")).toBe(false)
    expect(isMissedCallBookingCallbackMode("activity_follow_up")).toBe(false)
    expect(bookingLinkSmsToneFromSource("ivr")).toBe("booking_link")
    expect(bookingLinkSmsToneFromSource("cc_busy_hold_max_wait")).toBe("hold_timeout")
  })

  it("adds ?mode=callback on query-string fallback URLs", () => {
    const url = buildBookQueryUrl({
      callerPhone: "+15025550100",
      businessLine: "+15025550999",
      callbackMode: true,
    })
    expect(url).toContain("mode=callback")
    expect(url).toContain("line=")
  })
})
