import { describe, expect, it } from "vitest"
import { buildVerdictLabel, planRevenueCentsForTier } from "@/lib/admin-business-economics"

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
