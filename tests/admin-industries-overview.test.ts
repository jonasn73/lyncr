import { describe, expect, it } from "vitest"
import { AI_INTAKE_PROFILE_IDS } from "@/lib/business-industries"
import { buildAdminIndustryOverview } from "@/lib/admin-industries-overview"

describe("buildAdminIndustryOverview (admin /industries coverage matrix)", () => {
  it("returns exactly one row per catalog industry, in catalog order", () => {
    const rows = buildAdminIndustryOverview({})
    expect(rows.map((r) => r.id)).toEqual(AI_INTAKE_PROFILE_IDS)
  })

  it("wires live account counts through, defaulting to 0 when missing", () => {
    const rows = buildAdminIndustryOverview({ dental: 7, roofing: 3 })
    expect(rows.find((r) => r.id === "dental")?.liveAccountCount).toBe(7)
    expect(rows.find((r) => r.id === "roofing")?.liveAccountCount).toBe(3)
    expect(rows.find((r) => r.id === "handyman")?.liveAccountCount).toBe(0)
  })

  it("marks locksmith/plumbing/hvac/electrical/generic as bespoke AI scripts with no registry branches", () => {
    const rows = buildAdminIndustryOverview({})
    for (const id of ["locksmith", "plumbing", "hvac", "electrical", "generic"] as const) {
      const row = rows.find((r) => r.id === id)!
      expect(row.aiScript.source).toBe("bespoke")
      expect(row.aiScript.branchTitles).toEqual([])
    }
  })

  it("dental/it_support/flooring/handyman resolve real registry AI script branches", () => {
    const rows = buildAdminIndustryOverview({})
    for (const id of ["dental", "it_support", "flooring", "handyman"] as const) {
      const row = rows.find((r) => r.id === id)!
      expect(row.aiScript.source).toBe("registry")
      expect(row.aiScript.branchTitles.length).toBeGreaterThan(0)
      expect(row.jobTypes.source).toBe("registry")
      expect(row.jobTypes.options.length).toBeGreaterThan(0)
    }
  })

  it("maps equipment-on-file only for the intentionally-scoped trades", () => {
    const rows = buildAdminIndustryOverview({})
    const withEquipment = rows.filter((r) => r.equipment !== null).map((r) => r.id).sort()
    expect(withEquipment).toEqual(
      [
        "appliance_repair",
        "electrical",
        "garage_door",
        "hvac",
        "plumbing",
        "pool_service",
        "security_systems",
        "solar",
      ].sort()
    )
    expect(rows.find((r) => r.id === "dental")?.equipment).toBeNull()
  })

  it("is vehicle-aware only for locksmith, auto_repair, and towing", () => {
    const rows = buildAdminIndustryOverview({})
    const vehicleAware = rows.filter((r) => r.vehicleAware).map((r) => r.id).sort()
    expect(vehicleAware).toEqual(["auto_repair", "locksmith", "towing"].sort())
  })

  it("every row resolves to a real receptionist layout string", () => {
    const rows = buildAdminIndustryOverview({})
    for (const row of rows) {
      expect(["locksmith", "detailing", "auto_repair", "generic"]).toContain(row.receptionistLayout)
    }
  })
})
