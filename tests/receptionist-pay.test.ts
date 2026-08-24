import { describe, expect, it } from "vitest"
import {
  MIN_BILLABLE_TALK_SECONDS,
  calculateReceptionistPay,
  calculateReceptionistPayTotal,
  isAnsweredReceptionistCall,
  resolveReceptionistLegDurationSeconds,
} from "@/lib/receptionist-pay"

describe("what counts as payable", () => {
  it("does not pay for a call nobody picked up", () => {
    // The exact shape of both rows on the live ledger: the carrier marked the call
    // 'completed' when it ended, but answered_at was never set. These paid $2.50 each.
    expect(
      isAnsweredReceptionistCall({ status: "completed", answered_at: null })
    ).toBe(false)
  })

  it("does not pay for a caller who sat in the hold menu and hung up", () => {
    // routed_to_name was "Busy · hold menu" — 35 seconds of waiting, no human.
    expect(
      isAnsweredReceptionistCall({ status: "completed", answered_at: null })
    ).toBe(false)
  })

  it("pays when there is a real pickup", () => {
    expect(
      isAnsweredReceptionistCall({ status: "completed", answered_at: "2026-08-24T18:00:00.000Z" })
    ).toBe(true)
    expect(
      isAnsweredReceptionistCall({ status: "Answered", answered_at: "2026-08-24T18:00:00.000Z" })
    ).toBe(true)
  })

  it("still refuses a status that was never a pickup", () => {
    expect(
      isAnsweredReceptionistCall({ status: "no-answer", answered_at: "2026-08-24T18:00:00.000Z" })
    ).toBe(false)
  })
})

describe("talk time", () => {
  it("measures answered_at to ended_at", () => {
    expect(
      resolveReceptionistLegDurationSeconds({
        answered_at: "2026-05-01T12:00:00.000Z",
        ended_at: "2026-05-01T12:02:30.000Z",
        duration_seconds: 10,
      })
    ).toBe(150)
  })

  it("never falls back to duration_seconds", () => {
    // duration_seconds is the whole call including ring and hold. Falling back to it
    // billed a caller's wait as though someone had been talking to them.
    expect(
      resolveReceptionistLegDurationSeconds({
        answered_at: null,
        ended_at: null,
        duration_seconds: 35,
      })
    ).toBe(0)
  })

  it("returns zero when only one end of the leg is known", () => {
    expect(
      resolveReceptionistLegDurationSeconds({
        answered_at: "2026-05-01T12:00:00.000Z",
        ended_at: null,
        duration_seconds: 90,
      })
    ).toBe(0)
  })

  it("ignores an ended_at that precedes the pickup", () => {
    expect(
      resolveReceptionistLegDurationSeconds({
        answered_at: "2026-05-01T12:02:00.000Z",
        ended_at: "2026-05-01T12:00:00.000Z",
        duration_seconds: 60,
      })
    ).toBe(0)
  })
})

describe("payout", () => {
  it("pays nothing for an answer that ends immediately", () => {
    // Without a floor a 2-second pickup earns a full flat rate.
    expect(
      calculateReceptionistPay({
        durationInSeconds: 2,
        payMode: "FLAT_RATE",
        flatRateUsd: 2.5,
        isAnswered: true,
      })
    ).toBe(0)
  })

  it("pays the flat rate once past the minimum", () => {
    expect(
      calculateReceptionistPay({
        durationInSeconds: MIN_BILLABLE_TALK_SECONDS,
        payMode: "FLAT_RATE",
        flatRateUsd: 2.5,
        isAnswered: true,
      })
    ).toBe(2.5)
  })

  it("pays duration times rate per minute", () => {
    expect(
      calculateReceptionistPay({
        durationInSeconds: 120,
        payMode: "PER_MINUTE",
        ratePerMinute: 0.25,
        isAnswered: true,
      })
    ).toBe(0.5)
  })

  it("pays nothing when the leg was not answered, whatever the duration", () => {
    expect(
      calculateReceptionistPay({
        durationInSeconds: 300,
        payMode: "FLAT_RATE",
        flatRateUsd: 2.5,
        isAnswered: false,
      })
    ).toBe(0)
  })

  it("aggregates FLAT_RATE across calls", () => {
    expect(
      calculateReceptionistPayTotal({
        payMode: "FLAT_RATE",
        flatRateUsd: 2.5,
        answeredCalls: 4,
        totalTalkSeconds: 900,
      })
    ).toBe(10)
  })
})

describe("the live ledger, recomputed", () => {
  it("owes $0.00 for the two calls that showed $5.00", () => {
    // Both rows verbatim from call_logs on 2026-08-24.
    const rows = [
      { status: "completed", answered_at: null, ended_at: null, duration_seconds: 35 },
      { status: "completed", answered_at: null, ended_at: null, duration_seconds: 27 },
    ]
    const total = rows.reduce(
      (sum, row) =>
        sum +
        calculateReceptionistPay({
          durationInSeconds: resolveReceptionistLegDurationSeconds(row),
          payMode: "FLAT_RATE",
          flatRateUsd: 2.5,
          isAnswered: isAnsweredReceptionistCall(row),
        }),
      0
    )
    expect(total).toBe(0)
  })
})
