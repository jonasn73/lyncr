import { describe, expect, it } from "vitest"
import { resolveBusinessType } from "@/lib/business-type"

describe("resolveBusinessType", () => {
  it("resolves auto_repair for real auto-repair tags", () => {
    expect(resolveBusinessType("auto_repair")).toBe("auto_repair")
    expect(resolveBusinessType("Joe's Collision & Bodyshop")).toBe("auto_repair")
  })

  it("does not collapse appliance_repair into the auto_repair layout", () => {
    expect(resolveBusinessType("appliance_repair")).toBe("generic")
  })

  it("resolves locksmith and detailing tags correctly", () => {
    expect(resolveBusinessType("locksmith")).toBe("locksmith")
    expect(resolveBusinessType("auto_detailing")).toBe("detailing")
  })

  it("falls back to generic for empty or unrecognized tags", () => {
    expect(resolveBusinessType(null)).toBe("generic")
    expect(resolveBusinessType(undefined)).toBe("generic")
    expect(resolveBusinessType("dental")).toBe("generic")
  })
})
