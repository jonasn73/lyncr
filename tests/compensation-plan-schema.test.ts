import { describe, expect, it } from "vitest"
import {
  DEFAULT_ANSWERED_CALL_MIN_SECONDS,
  DEFAULT_TALK_TIME_MIN_SECONDS,
  applyBasisPoints,
  describePayComponent,
  describePayPlan,
  dollarsToMicros,
  legacyReceptionistComponents,
  microsToCents,
  parsePayComponent,
  parsePayComponents,
  validatePayComponents,
  type PayComponent,
} from "@/lib/compensation/plan-schema"

describe("money units", () => {
  it("keeps a per-second rate that dollars would truncate", () => {
    // $0.25/min is $0.004166.../sec. The old NUMERIC(6,4) column stored 0.0042 —
    // 0.8% high on every billed second. Rates are stored at their own unit instead.
    expect(dollarsToMicros(0.25)).toBe(250_000)
    expect(microsToCents(250_000 / 60)).toBe(0)
    expect(microsToCents((250_000 / 60) * 3600)).toBe(1500)
  })

  it("rounds to cents only at the end", () => {
    // 100 seconds at $0.25/min is 41.6667 cents.
    expect(microsToCents((100 / 60) * 250_000)).toBe(42)
  })

  it("applies basis points to a cent amount", () => {
    expect(applyBasisPoints(20_000, 500)).toBe(1000)
    expect(applyBasisPoints(0, 500)).toBe(0)
  })
})

describe("parsing components", () => {
  it("reads a time component and defaults its floor to none", () => {
    const parsed = parsePayComponent({
      kind: "TIME",
      unit: "SECOND",
      basis: "TALK",
      rate_micros: 4167,
    })
    expect(parsed).toEqual({
      kind: "TIME",
      unit: "SECOND",
      basis: "TALK",
      rate_micros: 4167,
      min_billable_seconds: DEFAULT_TALK_TIME_MIN_SECONDS,
    })
  })

  it("defaults an answered-call fee to the 20-second floor", () => {
    const parsed = parsePayComponent({
      kind: "PER_EVENT",
      event: "ANSWERED_CALL",
      amount_micros: 2_500_000,
    })
    expect(parsed).toMatchObject({ min_billable_seconds: DEFAULT_ANSWERED_CALL_MIN_SECONDS })
  })

  it("normalizes commission conditions to a fixed order", () => {
    const parsed = parsePayComponent({
      kind: "COMMISSION",
      rate_bps: 500,
      basis: "SUBTOTAL_EXCL_TAX",
      require: ["paid", "booked"],
    })
    expect(parsed).toMatchObject({ require: ["BOOKED", "PAID"] })
  })

  it("drops a component instead of throwing on it", () => {
    expect(parsePayComponent({ kind: "TIME", unit: "FORTNIGHT", basis: "TALK", rate_micros: 1 })).toBeNull()
    expect(parsePayComponent({ kind: "TIME", unit: "HOUR", basis: "TALK", rate_micros: 0 })).toBeNull()
    expect(parsePayComponent(null)).toBeNull()
  })

  it("keeps the good components when one is corrupt", () => {
    const parsed = parsePayComponents([
      { kind: "TIME", unit: "SECOND", basis: "TALK", rate_micros: 4167 },
      { kind: "NONSENSE" },
      { kind: "COMMISSION", rate_bps: 500, basis: "SUBTOTAL_EXCL_TAX", require: ["COMPLETED"] },
    ])
    expect(parsed.map((c) => c.kind)).toEqual(["TIME", "COMMISSION"])
  })
})

describe("validation", () => {
  const perSecond: PayComponent = {
    kind: "TIME",
    unit: "SECOND",
    basis: "TALK",
    rate_micros: 4167,
  }

  it("rejects an empty plan", () => {
    expect(validatePayComponents([], { employmentType: "CONTRACTOR_1099" }).errors).toHaveLength(1)
  })

  it("rejects two rates for the same time basis", () => {
    const { errors } = validatePayComponents(
      [perSecond, { kind: "TIME", unit: "MINUTE", basis: "TALK", rate_micros: 250_000 }],
      { employmentType: "CONTRACTOR_1099" }
    )
    expect(errors.join(" ")).toContain("twice")
  })

  it("allows talk time and shift time together", () => {
    const { errors } = validatePayComponents(
      [perSecond, { kind: "TIME", unit: "HOUR", basis: "ON_SHIFT", rate_micros: 15_000_000 }],
      { employmentType: "W2_EMPLOYEE" }
    )
    expect(errors).toEqual([])
  })

  it("rejects commission with no conditions", () => {
    const { errors } = validatePayComponents(
      [{ kind: "COMMISSION", rate_bps: 500, basis: "SUBTOTAL_EXCL_TAX", require: [] }],
      { employmentType: "CONTRACTOR_1099" }
    )
    expect(errors.join(" ")).toContain("at least one condition")
  })

  it("rejects a minimum-wage floor on a contractor", () => {
    const { errors } = validatePayComponents(
      [perSecond, { kind: "MINIMUM_WAGE_TOPUP", hourly_floor_micros: 7_250_000 }],
      { employmentType: "CONTRACTOR_1099" }
    )
    expect(errors.join(" ")).toContain("W-2 employees")
  })

  it("warns when a W-2 plan pays only for production", () => {
    // Waiting for the phone to ring is hours worked. Talk-time-only pay will not
    // clear minimum wage on a quiet shift.
    const { errors, warnings } = validatePayComponents([perSecond], {
      employmentType: "W2_EMPLOYEE",
    })
    expect(errors).toEqual([])
    expect(warnings.join(" ")).toContain("minimum-wage floor")
  })

  it("does not warn once a floor is attached", () => {
    const { warnings } = validatePayComponents(
      [perSecond, { kind: "MINIMUM_WAGE_TOPUP", hourly_floor_micros: 7_250_000 }],
      { employmentType: "W2_EMPLOYEE" }
    )
    expect(warnings.join(" ")).not.toContain("minimum-wage floor")
  })

  it("warns that an unclassified worker cannot be sent an agreement", () => {
    const { warnings } = validatePayComponents([perSecond], { employmentType: "UNSPECIFIED" })
    expect(warnings.join(" ")).toContain("employment type")
  })

  it("warns about commission that is not gated on payment", () => {
    const { warnings } = validatePayComponents(
      [{ kind: "COMMISSION", rate_bps: 500, basis: "SUBTOTAL_EXCL_TAX", require: ["COMPLETED"] }],
      { employmentType: "CONTRACTOR_1099" }
    )
    expect(warnings.join(" ")).toContain("never pays")
  })
})

describe("describing a plan", () => {
  it("shows a per-second rate at full precision", () => {
    // "$0.00 per talk second" would be a lie the worker signs.
    expect(
      describePayComponent({ kind: "TIME", unit: "SECOND", basis: "TALK", rate_micros: 4167 })
    ).toBe("$0.004167 per talk second")
  })

  it("names the floor on a flat per-call fee", () => {
    expect(
      describePayComponent({
        kind: "PER_EVENT",
        event: "ANSWERED_CALL",
        amount_micros: 2_500_000,
        min_billable_seconds: 20,
      })
    ).toBe("$2.50 per an answered call lasting at least 20 seconds")
  })

  it("writes the sentence a contract needs for per-second plus commission", () => {
    const plan: PayComponent[] = [
      { kind: "TIME", unit: "SECOND", basis: "TALK", rate_micros: 4167 },
      {
        kind: "COMMISSION",
        rate_bps: 500,
        basis: "SUBTOTAL_EXCL_TAX",
        require: ["BOOKED", "COMPLETED", "PAID"],
      },
    ]
    expect(describePayPlan(plan)).toBe(
      "$0.004167 per talk second plus 5% of the job subtotal before tax on jobs that are booked, completed, and paid"
    )
  })
})

describe("legacy receptionist rows", () => {
  it("reproduces FLAT_RATE as a per-answered-call fee with the old floor", () => {
    expect(legacyReceptionistComponents({ pay_mode: "FLAT_RATE", flat_rate_usd: 2.5 })).toEqual([
      {
        kind: "PER_EVENT",
        event: "ANSWERED_CALL",
        amount_micros: 2_500_000,
        min_billable_seconds: 20,
      },
    ])
  })

  it("reproduces PER_MINUTE as a talk-time rate with the old floor", () => {
    expect(legacyReceptionistComponents({ pay_mode: "PER_MINUTE", rate_per_minute: 0.25 })).toEqual([
      {
        kind: "TIME",
        unit: "MINUTE",
        basis: "TALK",
        rate_micros: 250_000,
        min_billable_seconds: 20,
      },
    ])
  })

  it("falls back to the documented defaults for a row with nothing set", () => {
    expect(legacyReceptionistComponents({})).toEqual([
      {
        kind: "TIME",
        unit: "MINUTE",
        basis: "TALK",
        rate_micros: 250_000,
        min_billable_seconds: 20,
      },
    ])
  })
})
