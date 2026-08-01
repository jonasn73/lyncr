import { describe, expect, it } from "vitest"
import {
  buildPriorPeriodNote,
  buildVerdictLabel,
  planRevenueCentsForTier,
} from "@/lib/admin-business-economics"
import {
  parseAdminMoneyPeriod,
  resolveAdminMoneyPeriodBounds,
} from "@/lib/admin-platform-finance"

describe("buildVerdictLabel", () => {
  it("shows how much we are behind with the absolute amount", () => {
    const v = buildVerdictLabel(-2302)
    expect(v.ahead).toBe(false)
    expect(v.verdict_label).toBe("We’re behind by $23.02")
    expect(v.net_abs_label).toBe("$23.02")
  })

  it("shows how much we are ahead with the absolute amount", () => {
    const v = buildVerdictLabel(4900)
    expect(v.ahead).toBe(true)
    expect(v.verdict_label).toBe("We’re ahead by $49.00")
    expect(v.net_abs_label).toBe("$49.00")
  })

  it("treats zero as even", () => {
    const v = buildVerdictLabel(0)
    expect(v.ahead).toBe(true)
    expect(v.verdict_label).toBe("We’re even · $0.00")
  })
})

describe("planRevenueCentsForTier", () => {
  it("returns 0 when not active — never invents list-price cash", () => {
    expect(planRevenueCentsForTier("professional", false)).toBe(0)
  })
})

describe("parseAdminMoneyPeriod", () => {
  it("defaults unknown values to all_time", () => {
    expect(parseAdminMoneyPeriod(null)).toBe("all_time")
    expect(parseAdminMoneyPeriod("nope")).toBe("all_time")
  })

  it("accepts all chip periods and last_30_days aliases", () => {
    expect(parseAdminMoneyPeriod("all_time")).toBe("all_time")
    expect(parseAdminMoneyPeriod("all")).toBe("all_time")
    expect(parseAdminMoneyPeriod("this_month")).toBe("this_month")
    expect(parseAdminMoneyPeriod("last_month")).toBe("last_month")
    expect(parseAdminMoneyPeriod("last-month")).toBe("last_month")
    expect(parseAdminMoneyPeriod("this_year")).toBe("this_year")
    expect(parseAdminMoneyPeriod("year")).toBe("this_year")
    expect(parseAdminMoneyPeriod("last_30_days")).toBe("last_30_days")
    expect(parseAdminMoneyPeriod("30d")).toBe("last_30_days")
  })
})

describe("resolveAdminMoneyPeriodBounds", () => {
  it("gives last_month an exclusive end at this month start", () => {
    // Fixed “now” so the test does not drift with the calendar.
    const now = new Date("2026-08-01T04:17:00.000Z")
    const thisMonth = resolveAdminMoneyPeriodBounds("this_month", now)
    const lastMonth = resolveAdminMoneyPeriodBounds("last_month", now)
    expect(lastMonth.ltUnix).toBe(thisMonth.gteUnix)
    expect(lastMonth.gteUnix).toBeLessThan(thisMonth.gteUnix)
    expect(lastMonth.label).toMatch(/July 2026/)
    expect(thisMonth.label).toMatch(/August 2026/)
  })

  it("uses open-ended all_time from epoch", () => {
    const now = new Date("2026-08-01T04:17:00.000Z")
    const all = resolveAdminMoneyPeriodBounds("all_time", now)
    expect(all.gteUnix).toBe(0)
    expect(all.ltUnix).toBeNull()
    expect(all.chip_label).toBe("All time")
    expect(all.label).toMatch(/All time/)
  })

  it("uses this_year from Jan 1 Eastern open-ended", () => {
    const now = new Date("2026-08-01T04:17:00.000Z")
    const year = resolveAdminMoneyPeriodBounds("this_year", now)
    expect(year.ltUnix).toBeNull()
    expect(year.chip_label).toBe("This year")
    expect(year.label).toMatch(/2026 year to date/)
    expect(year.gteUnix).toBeLessThan(resolveAdminMoneyPeriodBounds("this_month", now).gteUnix)
  })

  it("keeps rolling last_30_days for API compatibility", () => {
    const now = new Date("2026-08-01T04:17:00.000Z")
    const d30 = resolveAdminMoneyPeriodBounds("last_30_days", now)
    expect(d30.ltUnix).toBeNull()
    expect(d30.label).toBe("Last 30 days (rolling)")
    expect(now.getTime() / 1000 - d30.gteUnix).toBeCloseTo(30 * 24 * 60 * 60, 0)
  })
})

describe("buildPriorPeriodNote", () => {
  it("explains empty this-month when last month had calls and fees", () => {
    const note = buildPriorPeriodNote({
      currentMonthLabel: "August 2026 (US Eastern)",
      priorMonthLabel: "July 2026 (US Eastern)",
      prior: {
        user_id: "u1",
        call_count: 550,
        talk_seconds: 37163,
        sms_count: 31,
      },
      priorCardFeeCents: 2302,
    })
    expect(note).toContain("Showing August 2026 only")
    expect(note).toContain("550 calls")
    expect(note).toContain("620 talk min")
    expect(note).toContain("31 SMS")
    expect(note).toContain("$23.02 card fees")
    expect(note).toContain("Last month")
    expect(note).toContain("All time")
  })

  it("returns null when prior month had no activity", () => {
    expect(
      buildPriorPeriodNote({
        currentMonthLabel: "August 2026 (US Eastern)",
        priorMonthLabel: "July 2026 (US Eastern)",
        prior: { user_id: "u1", call_count: 0, talk_seconds: 0, sms_count: 0 },
        priorCardFeeCents: 0,
      })
    ).toBeNull()
  })
})
