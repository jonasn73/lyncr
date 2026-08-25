import { describe, expect, it } from "vitest"
import {
  calculateEarnings,
  calculateMinimumWageTopUp,
  reverseEarningLine,
  splitIntoWorkweeks,
  sumEarningCents,
  type CallPayEvent,
  type JobPayEvent,
  type ShiftPayEvent,
} from "@/lib/compensation/calculate"
import type { PayComponent } from "@/lib/compensation/plan-schema"

const PER_SECOND: PayComponent = {
  kind: "TIME",
  unit: "SECOND",
  basis: "TALK",
  rate_micros: 4167,
  min_billable_seconds: 0,
}

const PER_ANSWERED_CALL: PayComponent = {
  kind: "PER_EVENT",
  event: "ANSWERED_CALL",
  amount_micros: 2_500_000,
  min_billable_seconds: 20,
}

const COMMISSION: PayComponent = {
  kind: "COMMISSION",
  rate_bps: 500,
  basis: "SUBTOTAL_EXCL_TAX",
  require: ["BOOKED", "COMPLETED", "PAID"],
}

function call(overrides: Partial<CallPayEvent> = {}): CallPayEvent {
  return {
    kind: "CALL",
    id: "call-1",
    occurred_at: "2026-08-25T15:00:00.000Z",
    answered: true,
    talk_seconds: 120,
    ...overrides,
  }
}

function job(overrides: Partial<JobPayEvent> = {}): JobPayEvent {
  return {
    kind: "JOB",
    id: "job-1",
    occurred_at: "2026-08-25T17:00:00.000Z",
    booked: true,
    completed: true,
    paid: true,
    base_cents: { COLLECTED_TOTAL: 21_400, SUBTOTAL_EXCL_TAX: 20_000, LABOR_ONLY: 12_000 },
    ...overrides,
  }
}

function shift(overrides: Partial<ShiftPayEvent> = {}): ShiftPayEvent {
  return {
    kind: "SHIFT",
    id: "shift-1",
    occurred_at: "2026-08-25T22:00:00.000Z",
    seconds: 8 * 3600,
    ...overrides,
  }
}

describe("time on calls", () => {
  it("pays per talk second", () => {
    const [line] = calculateEarnings([PER_SECOND], call({ talk_seconds: 120 }))
    // 120 × $0.004167 = $0.50004 → 50 cents.
    expect(line.amount_cents).toBe(50)
    expect(line.quantity).toBe(120)
    expect(line.source_kind).toBe("CALL")
  })

  it("pays nothing for a leg nobody picked up, whatever its length", () => {
    expect(calculateEarnings([PER_SECOND], call({ answered: false, talk_seconds: 300 }))).toEqual([])
  })

  it("has no cliff at 20 seconds when paying per second", () => {
    // A flat fee needs a floor; a proportional rate does not, and imposing one would
    // mean 19 seconds earns nothing while 20 earns a full 20 seconds' worth.
    const nineteen = sumEarningCents(calculateEarnings([PER_SECOND], call({ talk_seconds: 19 })))
    expect(nineteen).toBeGreaterThan(0)
  })

  it("still applies the floor to a flat per-call fee", () => {
    expect(calculateEarnings([PER_ANSWERED_CALL], call({ talk_seconds: 2 }))).toEqual([])
    const [line] = calculateEarnings([PER_ANSWERED_CALL], call({ talk_seconds: 20 }))
    expect(line.amount_cents).toBe(250)
  })

  it("ignores shift-based time on a call", () => {
    const onShift: PayComponent = { kind: "TIME", unit: "HOUR", basis: "ON_SHIFT", rate_micros: 15_000_000 }
    expect(calculateEarnings([onShift], call())).toEqual([])
  })
})

describe("jobs", () => {
  it("pays a flat amount on completion", () => {
    const perJob: PayComponent = { kind: "PER_EVENT", event: "COMPLETED_JOB", amount_micros: 30_000_000 }
    const [line] = calculateEarnings([perJob], job())
    expect(line.amount_cents).toBe(3000)
    expect(line.quantity).toBe(1)
  })

  it("withholds the completion fee until the job is complete", () => {
    const perJob: PayComponent = { kind: "PER_EVENT", event: "COMPLETED_JOB", amount_micros: 30_000_000 }
    expect(calculateEarnings([perJob], job({ completed: false }))).toEqual([])
  })

  it("commissions the subtotal, not the collected total", () => {
    // The collected total carries sales tax the business is about to remit.
    const [line] = calculateEarnings([COMMISSION], job())
    expect(line.amount_cents).toBe(1000)
    expect(line.quantity).toBe(20_000)
  })

  it("holds commission until every condition is met", () => {
    expect(calculateEarnings([COMMISSION], job({ paid: false }))).toEqual([])
    expect(calculateEarnings([COMMISSION], job({ completed: false }))).toEqual([])
    expect(calculateEarnings([COMMISSION], job({ booked: false }))).toEqual([])
  })

  it("refuses to pay a commission stored with no conditions", () => {
    // validatePayComponents blocks this at save time; this is the second gate for
    // rows already in the table.
    const ungated: PayComponent = {
      kind: "COMMISSION",
      rate_bps: 500,
      basis: "SUBTOTAL_EXCL_TAX",
      require: [],
    }
    expect(calculateEarnings([ungated], job())).toEqual([])
  })
})

describe("shifts", () => {
  it("pays an hourly rate on clocked time", () => {
    const hourly: PayComponent = { kind: "TIME", unit: "HOUR", basis: "ON_SHIFT", rate_micros: 15_000_000 }
    const [line] = calculateEarnings([hourly], shift({ seconds: 8 * 3600 }))
    expect(line.amount_cents).toBe(12_000)
    expect(line.source_kind).toBe("SHIFT")
  })

  it("ignores talk-time pay on a shift", () => {
    expect(calculateEarnings([PER_SECOND], shift())).toEqual([])
  })
})

describe("per second plus commission", () => {
  const plan = [PER_SECOND, COMMISSION]

  it("pays only the time component when a call comes in", () => {
    const lines = calculateEarnings(plan, call({ talk_seconds: 240 }))
    expect(lines.map((l) => l.component_kind)).toEqual(["TIME"])
    expect(lines[0].amount_cents).toBe(100)
  })

  it("pays only the commission when the job settles", () => {
    const lines = calculateEarnings(plan, job())
    expect(lines.map((l) => l.component_kind)).toEqual(["COMMISSION"])
    expect(lines[0].amount_cents).toBe(1000)
  })

  it("never pays the same event under two components", () => {
    const lines = [...calculateEarnings(plan, call({ talk_seconds: 240 })), ...calculateEarnings(plan, job())]
    expect(sumEarningCents(lines)).toBe(1100)
    expect(new Set(lines.map((l) => `${l.source_kind}:${l.source_id}:${l.component_kind}`)).size).toBe(2)
  })
})

describe("minimum wage floor", () => {
  const floor: PayComponent = { kind: "MINIMUM_WAGE_TOPUP", hourly_floor_micros: 7_250_000 }

  it("tops up a quiet shift that talk-time pay underpaid", () => {
    // 8 hours at $7.25 is $58.00. Twelve minutes of talk at $0.004167/sec earned $3.00.
    const line = calculateMinimumWageTopUp({
      components: [PER_SECOND, floor],
      weekEarnedCents: 300,
      onShiftSeconds: 8 * 3600,
      workweekId: "week-1",
      earnedAt: "2026-08-25T22:00:00.000Z",
    })
    expect(line?.amount_cents).toBe(5500)
    expect(line?.source_kind).toBe("ADJUSTMENT")
  })

  it("pays nothing when the worker already cleared the floor", () => {
    expect(
      calculateMinimumWageTopUp({
        components: [PER_SECOND, floor],
        weekEarnedCents: 20_000,
        onShiftSeconds: 8 * 3600,
        workweekId: "week-1",
        earnedAt: "2026-08-25T22:00:00.000Z",
      })
    ).toBeNull()
  })

  it("has nothing to apply without clocked time", () => {
    expect(
      calculateMinimumWageTopUp({
        components: [PER_SECOND, floor],
        weekEarnedCents: 0,
        onShiftSeconds: 0,
        workweekId: "week-1",
        earnedAt: "2026-08-25T22:00:00.000Z",
      })
    ).toBeNull()
  })

  it("is skipped entirely when the plan has no floor", () => {
    expect(
      calculateMinimumWageTopUp({
        components: [PER_SECOND],
        weekEarnedCents: 0,
        onShiftSeconds: 8 * 3600,
        workweekId: "week-1",
        earnedAt: "2026-08-25T22:00:00.000Z",
      })
    ).toBeNull()
  })
})

describe("the floor is judged per workweek", () => {
  const floor: PayComponent = { kind: "MINIMUM_WAGE_TOPUP", hourly_floor_micros: 7_250_000 }

  it("splits a fortnightly period into two weeks", () => {
    const weeks = splitIntoWorkweeks("2026-08-02T00:00:00.000Z", "2026-08-16T00:00:00.000Z")
    expect(weeks).toHaveLength(2)
    expect(weeks[0].startIso).toBe("2026-08-02T00:00:00.000Z")
    expect(weeks[1].startIso).toBe("2026-08-09T00:00:00.000Z")
  })

  it("clips the first and last weeks to the period", () => {
    // A period starting mid-week must not reach back into the previous one.
    const weeks = splitIntoWorkweeks("2026-08-05T00:00:00.000Z", "2026-08-12T00:00:00.000Z")
    expect(weeks[0].startIso).toBe("2026-08-05T00:00:00.000Z")
    expect(weeks[weeks.length - 1].endIso).toBe("2026-08-12T00:00:00.000Z")
  })

  it("honors an employer whose week starts on Monday", () => {
    // 2026-08-02 is a Sunday; with weekStartDay=1 the boundary is the 3rd.
    const weeks = splitIntoWorkweeks("2026-08-02T00:00:00.000Z", "2026-08-16T00:00:00.000Z", 1)
    expect(weeks[1].startIso).toBe("2026-08-03T00:00:00.000Z")
  })

  it("will not let a busy week subsidize a dead one", () => {
    // The FLSA takes a single workweek as its standard and does not permit averaging.
    // Week 1: 20 hours, earned $200 — clears $7.25 easily.
    // Week 2: 20 hours, earned $50 — owes 20 × $7.25 − $50 = $95.
    const busy = calculateMinimumWageTopUp({
      components: [PER_SECOND, floor],
      weekEarnedCents: 20_000,
      onShiftSeconds: 20 * 3600,
      workweekId: "week-1",
      earnedAt: "2026-08-09T00:00:00.000Z",
    })
    const dead = calculateMinimumWageTopUp({
      components: [PER_SECOND, floor],
      weekEarnedCents: 5_000,
      onShiftSeconds: 20 * 3600,
      workweekId: "week-2",
      earnedAt: "2026-08-16T00:00:00.000Z",
    })
    expect(busy).toBeNull()
    expect(dead?.amount_cents).toBe(9_500)

    // Averaged over the fortnight: 40 hours, $250 earned, floor $290 — a $40 shortfall
    // where $95 is actually owed. The good week absorbs most of the bad one, which is
    // the averaging the FLSA does not allow and the reason this takes a workweek.
    const averaged = calculateMinimumWageTopUp({
      components: [PER_SECOND, floor],
      weekEarnedCents: 25_000,
      onShiftSeconds: 40 * 3600,
      workweekId: "period-1",
      earnedAt: "2026-08-16T00:00:00.000Z",
    })
    expect(averaged?.amount_cents).toBe(4_000)
    expect(averaged!.amount_cents).toBeLessThan(dead!.amount_cents)
  })

  it("keys each week separately so two top-ups can coexist", () => {
    // A shared pay-period id would collide on the ledger's dedupe index and silently
    // drop the second week's top-up.
    const first = calculateMinimumWageTopUp({
      components: [PER_SECOND, floor],
      weekEarnedCents: 0,
      onShiftSeconds: 10 * 3600,
      workweekId: "week-1",
      earnedAt: "2026-08-09T00:00:00.000Z",
    })
    const second = calculateMinimumWageTopUp({
      components: [PER_SECOND, floor],
      weekEarnedCents: 0,
      onShiftSeconds: 10 * 3600,
      workweekId: "week-2",
      earnedAt: "2026-08-16T00:00:00.000Z",
    })
    expect(first?.source_id).not.toBe(second?.source_id)
  })
})

describe("reversals", () => {
  it("negates a line so a refunded job cancels out", () => {
    const [line] = calculateEarnings([COMMISSION], job())
    const reversal = reverseEarningLine(line, "2026-08-26T10:00:00.000Z")
    expect(reversal.amount_cents).toBe(-line.amount_cents)
    expect(sumEarningCents([line, reversal])).toBe(0)
  })
})
