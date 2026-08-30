import { describe, expect, it } from "vitest"
import {
  commissionCentsFromCharge,
  ledgerStatusForIntent,
  normalizeJobPaymentMethod,
  resolveVerifiedChargeCents,
  type JobPaymentContext,
} from "@/lib/job-payments"

const baseJob = (expected: number | null): JobPaymentContext => ({
  jobId: "job-1",
  ownerUserId: "owner-1",
  assignedTechId: "tech-1",
  jobStatus: "arrived",
  expectedChargeCents: expected,
})

describe("normalizeJobPaymentMethod", () => {
  it("accepts TAP_TO_PAY and MANUAL_CARD", () => {
    expect(normalizeJobPaymentMethod("TAP_TO_PAY")).toBe("TAP_TO_PAY")
    expect(normalizeJobPaymentMethod("manual_card")).toBe("MANUAL_CARD")
    expect(normalizeJobPaymentMethod("card")).toBe("MANUAL_CARD")
  })

  it("rejects cash (offline path)", () => {
    expect(normalizeJobPaymentMethod("CASH")).toBeNull()
  })
})

describe("resolveVerifiedChargeCents", () => {
  it("accepts dollar amounts matching the job price", () => {
    expect(resolveVerifiedChargeCents(baseJob(14999), 149.99)).toEqual({
      ok: true,
      chargeCents: 14999,
    })
  })

  it("rejects mismatched amounts when job price is set", () => {
    const result = resolveVerifiedChargeCents(baseJob(14999), 100)
    expect(result.ok).toBe(false)
  })

  it("allows invoice override when tech builds on-site line items", () => {
    expect(resolveVerifiedChargeCents(baseJob(14999), 375, { allowInvoiceOverride: true })).toEqual({
      ok: true,
      chargeCents: 37500,
    })
  })

  it("allows client amount when job has no stored price", () => {
    expect(resolveVerifiedChargeCents(baseJob(null), 85.5)).toEqual({
      ok: true,
      chargeCents: 8550,
    })
  })
})

describe("commissionCentsFromCharge", () => {
  it("returns full charge when rate defaults to 1", () => {
    const prev = process.env.TECH_JOB_COMMISSION_RATE
    delete process.env.TECH_JOB_COMMISSION_RATE
    expect(commissionCentsFromCharge(10000)).toBe(10000)
    if (prev === undefined) delete process.env.TECH_JOB_COMMISSION_RATE
    else process.env.TECH_JOB_COMMISSION_RATE = prev
  })

  it("applies TECH_JOB_COMMISSION_RATE", () => {
    const prev = process.env.TECH_JOB_COMMISSION_RATE
    process.env.TECH_JOB_COMMISSION_RATE = "0.7"
    expect(commissionCentsFromCharge(10000)).toBe(7000)
    if (prev === undefined) delete process.env.TECH_JOB_COMMISSION_RATE
    else process.env.TECH_JOB_COMMISSION_RATE = prev
  })
})

describe("ledgerStatusForIntent", () => {
  it("credits the wallet the moment Stripe reports succeeded", () => {
    // The owner should not have to wait on the browser's confirm call or a webhook — a missed
    // settle used to strand real money at PENDING, hidden from the list and the total.
    expect(ledgerStatusForIntent("succeeded")).toBe("COMPLETED")
  })

  it("leaves money that is not in hand yet PENDING", () => {
    // processing = still clearing; requires_capture = authorized only, nothing captured.
    expect(ledgerStatusForIntent("processing")).toBe("PENDING")
    expect(ledgerStatusForIntent("requires_capture")).toBe("PENDING")
    expect(ledgerStatusForIntent("requires_payment_method")).toBe("PENDING")
    expect(ledgerStatusForIntent("requires_action")).toBe("PENDING")
    expect(ledgerStatusForIntent("canceled")).toBe("PENDING")
  })
})
