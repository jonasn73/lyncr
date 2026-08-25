import { describe, expect, it } from "vitest"
import { resolveCallSettlement } from "@/lib/compensation/settle-call"
import { legacyReceptionistComponents, type PayComponent } from "@/lib/compensation/plan-schema"

const PER_MINUTE = legacyReceptionistComponents({ pay_mode: "PER_MINUTE", rate_per_minute: 0.25 })
const FLAT_RATE = legacyReceptionistComponents({ pay_mode: "FLAT_RATE", flat_rate_usd: 2.5 })

const PER_SECOND: PayComponent[] = [
  { kind: "TIME", unit: "SECOND", basis: "TALK", rate_micros: 4167, min_billable_seconds: 0 },
]

function leg(overrides: Partial<Parameters<typeof resolveCallSettlement>[0]> = {}) {
  return resolveCallSettlement({
    callId: "call-1",
    status: "completed",
    answered_at: "2026-08-25T15:00:00.000Z",
    ended_at: "2026-08-25T15:02:00.000Z",
    components: PER_MINUTE,
    ...overrides,
  })
}

describe("settling an answered leg", () => {
  it("pays talk time and dates the row at the end of the call", () => {
    const decision = leg()
    expect(decision.lines).toHaveLength(1)
    expect(decision.lines[0].amount_cents).toBe(50)
    expect(decision.earnedAt).toBe("2026-08-25T15:02:00.000Z")
    expect(decision.reason).toBeUndefined()
  })

  it("carries the call id so the row can be deduped against it", () => {
    expect(leg().lines[0].source_id).toBe("call-1")
    expect(leg().lines[0].source_kind).toBe("CALL")
  })
})

describe("the three ways to earn nothing", () => {
  it("is final when nobody picked up", () => {
    // The carrier marks a call 'completed' when it ends, which is true of every call
    // that rings out or lands in the hold menu. answered_at is what gates pay.
    const decision = leg({ answered_at: null })
    expect(decision.reason).toBe("not_answered")
    expect(decision.retryable).toBe(false)
  })

  it("is final when the status was never a pickup", () => {
    const decision = leg({ status: "no-answer" })
    expect(decision.reason).toBe("not_answered")
    expect(decision.retryable).toBe(false)
  })

  it("is retryable while ended_at has not landed", () => {
    // Settling now would write nothing; writing a zero row instead would claim the
    // call was settled, and the dedupe index would then block the real amount.
    const decision = leg({ ended_at: null })
    expect(decision.reason).toBe("no_talk_time")
    expect(decision.retryable).toBe(true)
    expect(decision.lines).toEqual([])
  })

  it("is final when the plan genuinely pays zero for the leg", () => {
    const decision = leg({
      ended_at: "2026-08-25T15:00:03.000Z",
      components: FLAT_RATE,
    })
    expect(decision.reason).toBe("earned_nothing")
    expect(decision.retryable).toBe(false)
  })

  it("never treats a backwards ended_at as talk time", () => {
    const decision = leg({
      answered_at: "2026-08-25T15:02:00.000Z",
      ended_at: "2026-08-25T15:00:00.000Z",
    })
    expect(decision.reason).toBe("no_talk_time")
  })
})

describe("what the leg is worth", () => {
  it("matches the legacy per-minute amount exactly", () => {
    // 120 seconds at $0.25/min was $0.50 under the old derive-on-read path.
    expect(leg({ components: PER_MINUTE }).lines[0].amount_cents).toBe(50)
  })

  it("matches the legacy flat rate exactly once past the floor", () => {
    expect(
      leg({ ended_at: "2026-08-25T15:00:20.000Z", components: FLAT_RATE }).lines[0].amount_cents
    ).toBe(250)
  })

  it("pays a short call under a per-second plan that a flat rate would refuse", () => {
    const shortLeg = { ended_at: "2026-08-25T15:00:05.000Z" }
    expect(leg({ ...shortLeg, components: FLAT_RATE }).reason).toBe("earned_nothing")
    expect(leg({ ...shortLeg, components: PER_SECOND }).lines[0].amount_cents).toBe(2)
  })

  it("does not double-pay when a plan has both time and a per-call fee", () => {
    const both = [...PER_SECOND, ...FLAT_RATE]
    const lines = leg({ components: both }).lines
    expect(lines.map((l) => l.component_kind).sort()).toEqual(["PER_EVENT", "TIME"])
    // Two components, two distinct ledger rows — the dedupe index keys on
    // component_kind precisely so both can coexist against one call.
    expect(new Set(lines.map((l) => l.component_kind)).size).toBe(2)
  })
})
