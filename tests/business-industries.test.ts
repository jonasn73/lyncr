import { describe, expect, it } from "vitest"
import {
  AI_INTAKE_PROFILE_IDS,
  SIGNUP_INDUSTRY_OPTIONS,
  defaultProfileFromUserIndustry,
  isAiIntakeProfileId,
} from "@/lib/business-industries"
import { resolveJobIntakeOptionsSource } from "@/lib/job-intake-registry"

describe("auto_detailing catalog entry", () => {
  it("is a real, signup-selectable catalog id", () => {
    expect(AI_INTAKE_PROFILE_IDS).toContain("auto_detailing")
    expect(SIGNUP_INDUSTRY_OPTIONS.map((o) => o.value)).toContain("auto_detailing")
    expect(isAiIntakeProfileId("auto_detailing")).toBe(true)
  })

  it("free-text aliases resolve to auto_detailing", () => {
    for (const alias of ["detailing", "detail", "car_wash", "carwash", "Auto Detailing"]) {
      expect(defaultProfileFromUserIndustry(alias)).toBe("auto_detailing")
    }
  })

  it("has no bespoke/registry entry yet — falls back to the generic job-type list", () => {
    expect(resolveJobIntakeOptionsSource("auto_detailing")).toBe("generic_fallback")
  })
})
