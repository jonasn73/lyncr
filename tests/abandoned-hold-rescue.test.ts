import { describe, expect, it } from "vitest"
import {
  abandonedHoldRescueDelayMinutes,
  hasCompleteHoldIntake,
  shouldRescueAbandonedHold,
} from "@/lib/abandoned-hold-rescue"
import { isTollFreeE164 } from "@/lib/phone-e164"
import { buildTelnyxMenuBookingSms } from "@/lib/telnyx-menu"

describe("shouldRescueAbandonedHold", () => {
  it("rescues callers who held a meaningful amount of time", () => {
    expect(
      shouldRescueAbandonedHold({ heldSecs: 92, answeredIntake: false, callerE164: "+15023220137" })
    ).toBe(true)
  })

  it("rescues quick hangups only when they engaged with intake", () => {
    expect(
      shouldRescueAbandonedHold({ heldSecs: 12, answeredIntake: true, callerE164: "+15023220137" })
    ).toBe(true)
    expect(
      shouldRescueAbandonedHold({ heldSecs: 12, answeredIntake: false, callerE164: "+15023220137" })
    ).toBe(false)
  })

  it("never texts toll-free callers", () => {
    expect(
      shouldRescueAbandonedHold({ heldSecs: 300, answeredIntake: true, callerE164: "+18003536737" })
    ).toBe(false)
  })
})

describe("hasCompleteHoldIntake", () => {
  it("needs an intent at minimum", () => {
    expect(hasCompleteHoldIntake({})).toBe(false)
    expect(hasCompleteHoldIntake({ intent_slug: "locksmith_lockout" })).toBe(true)
  })

  it("requires vehicle detail for key-generation", () => {
    expect(hasCompleteHoldIntake({ intent_slug: "locksmith_key_generation" })).toBe(false)
    expect(
      hasCompleteHoldIntake({
        intent_slug: "locksmith_key_generation",
        vehicle_year: "2016",
      })
    ).toBe(true)
    expect(
      hasCompleteHoldIntake({
        intent_slug: "locksmith_key_generation",
        vehicle_make_model_label: "Chrysler 200",
      })
    ).toBe(true)
  })

  it("treats a pending vehicle clip as incomplete", () => {
    expect(
      hasCompleteHoldIntake({
        intent_slug: "locksmith_key_generation",
        vehicle_year: "2016",
        vehicle_voice_pending: true,
      })
    ).toBe(false)
  })
})

describe("abandonedHoldRescueDelayMinutes", () => {
  it("texts right away unless after hours with complete intake", () => {
    expect(
      abandonedHoldRescueDelayMinutes({ presenceClosed: false, completeIntake: false })
    ).toBe(0)
    expect(
      abandonedHoldRescueDelayMinutes({ presenceClosed: false, completeIntake: true })
    ).toBe(0)
    expect(
      abandonedHoldRescueDelayMinutes({ presenceClosed: true, completeIntake: false })
    ).toBe(0)
    expect(
      abandonedHoldRescueDelayMinutes({ presenceClosed: true, completeIntake: true })
    ).toBe(15)
  })
})

describe("isTollFreeE164", () => {
  it("matches all US toll-free prefixes, in any common format", () => {
    for (const p of ["800", "833", "844", "855", "866", "877", "888"]) {
      expect(isTollFreeE164(`+1${p}5551234`)).toBe(true)
      expect(isTollFreeE164(`${p}5551234`)).toBe(true)
    }
    expect(isTollFreeE164("(800) 353-6737")).toBe(true)
  })

  it("leaves ordinary numbers alone", () => {
    expect(isTollFreeE164("+15023220137")).toBe(false)
    // 812 is an Indiana area code, not toll-free.
    expect(isTollFreeE164("+18125551234")).toBe(false)
    expect(isTollFreeE164("")).toBe(false)
    expect(isTollFreeE164(null)).toBe(false)
  })
})

describe("missed-call rescue SMS copy", () => {
  it("keeps the classic copy when nothing was captured", () => {
    const sms = buildTelnyxMenuBookingSms(
      "+15025550100",
      "https://lyncr.app/b/AB12CD34",
      null,
      "missed_call"
    )
    expect(sms).toBe("Sorry we missed your call — when you need us: https://lyncr.app/b/AB12CD34")
  })

  it("frames a captured-intake abandon as finishing up, never as a missed call", () => {
    const sms = buildTelnyxMenuBookingSms(
      "+15025550100",
      "https://lyncr.app/b/AB12CD34",
      null,
      "missed_call",
      "Key Squad",
      { summary: "Lost key / needs new key made", prefill: { intent_slug: "locksmith_key_generation" } }
    )
    // They answered questions on the call — "we missed you" would ring false.
    expect(sms).not.toContain("missed your call")
    expect(sms).toContain("we saved your details")
    expect(sms).toContain("finish up here")
    expect(sms).not.toContain("Lost key")
    expect(sms.endsWith("https://lyncr.app/b/AB12CD34")).toBe(true)
  })
})
