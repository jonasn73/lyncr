import { describe, expect, it } from "vitest"
import { calculateEarnings, type JobPayEvent } from "@/lib/compensation/calculate"
import type { PayComponent } from "@/lib/compensation/plan-schema"

// A $200 job with 7% tax and a $20 tip, as the pay-link path records it:
// subtotal 20000, tax 1400, tip 2000 (tips sit outside every commission base).
const BASES: JobPayEvent["base_cents"] = {
  SUBTOTAL_EXCL_TAX: 20_000,
  COLLECTED_TOTAL: 21_400,
  LABOR_ONLY: 20_000,
}

function job(overrides: Partial<JobPayEvent> = {}): JobPayEvent {
  return {
    kind: "JOB",
    id: "job-1",
    occurred_at: "2026-08-25T17:00:00.000Z",
    booked: true,
    completed: true,
    paid: true,
    base_cents: BASES,
    ...overrides,
  }
}

const THIRTY_PERCENT: PayComponent = {
  kind: "COMMISSION",
  rate_bps: 3000,
  basis: "SUBTOTAL_EXCL_TAX",
  require: ["COMPLETED", "PAID"],
}

describe("what a tech takes home on a job", () => {
  it("commissions the subtotal, leaving tax out", () => {
    // 30% of $200, not 30% of $214 — the $14 is sales tax being remitted.
    const [line] = calculateEarnings([THIRTY_PERCENT], job())
    expect(line.amount_cents).toBe(6_000)
  })

  it("costs the business $4.20 more per job to commission the gross", () => {
    const onGross: PayComponent = { ...THIRTY_PERCENT, basis: "COLLECTED_TOTAL" }
    const [subtotal] = calculateEarnings([THIRTY_PERCENT], job())
    const [gross] = calculateEarnings([onGross], job())
    expect(gross.amount_cents - subtotal.amount_cents).toBe(420)
  })

  it("pays nothing until the customer has actually paid", () => {
    expect(calculateEarnings([THIRTY_PERCENT], job({ paid: false }))).toEqual([])
  })

  it("pays nothing on a job worth nothing", () => {
    const worthless = job({
      base_cents: { SUBTOTAL_EXCL_TAX: 0, COLLECTED_TOTAL: 0, LABOR_ONLY: 0 },
    })
    expect(calculateEarnings([THIRTY_PERCENT], worthless)).toEqual([])
  })

  it("records the money the percentage was taken from", () => {
    // quantity carries the base, so a disputed amount can be checked without
    // re-resolving what the job was worth months later.
    const [line] = calculateEarnings([THIRTY_PERCENT], job())
    expect(line.quantity).toBe(20_000)
  })
})

describe("a flat per-job fee alongside commission", () => {
  const plan: PayComponent[] = [
    THIRTY_PERCENT,
    { kind: "PER_EVENT", event: "COMPLETED_JOB", amount_micros: 25_000_000 },
  ]

  it("pays both, as two separate rows", () => {
    const lines = calculateEarnings(plan, job())
    expect(lines.map((l) => l.component_kind).sort()).toEqual(["COMMISSION", "PER_EVENT"])
    expect(lines.reduce((sum, l) => sum + l.amount_cents, 0)).toBe(8_500)
  })

  it("still pays the completion fee when the customer has not paid yet", () => {
    // The flat fee is gated on completion; only the commission waits for payment.
    const lines = calculateEarnings(plan, job({ paid: false }))
    expect(lines.map((l) => l.component_kind)).toEqual(["PER_EVENT"])
  })
})

describe("the receptionist who booked it", () => {
  const bookingPlan: PayComponent[] = [
    { kind: "TIME", unit: "SECOND", basis: "TALK", rate_micros: 4167, min_billable_seconds: 0 },
    {
      kind: "COMMISSION",
      rate_bps: 500,
      basis: "SUBTOTAL_EXCL_TAX",
      require: ["BOOKED", "COMPLETED", "PAID"],
    },
  ]

  it("earns 5% once the job is booked, done, and paid", () => {
    const lines = calculateEarnings(bookingPlan, job())
    expect(lines.map((l) => l.component_kind)).toEqual(["COMMISSION"])
    expect(lines[0].amount_cents).toBe(1_000)
  })

  it("earns nothing on a job that was booked but never completed", () => {
    expect(calculateEarnings(bookingPlan, job({ completed: false }))).toEqual([])
  })

  it("does not double-dip on the call that produced the job", () => {
    // Talk time is a CALL component and never fires on a JOB event, so booking a job
    // during a paid call earns the call rate once and the commission once.
    const lines = calculateEarnings(bookingPlan, job())
    expect(lines.some((l) => l.component_kind === "TIME")).toBe(false)
  })
})
