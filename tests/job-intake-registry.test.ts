import { describe, expect, it } from "vitest"
import { AI_INTAKE_PROFILE_IDS } from "@/lib/business-industries"
import { SERVICE_QUOTE_TYPES } from "@/lib/service-quote-calculator"
import {
  isVehicleAwareIndustry,
  jobIntakeOptionRequiresVehicle,
  resolveJobIntakeOptions,
} from "@/lib/job-intake-registry"

describe("resolveJobIntakeOptions (087) — every trade resolves to a real, non-empty list", () => {
  it("covers every AiIntakeProfileId with at least one option", () => {
    for (const industry of AI_INTAKE_PROFILE_IDS) {
      const options = resolveJobIntakeOptions(industry)
      expect(options.length, `industry "${industry}" resolved to zero options`).toBeGreaterThan(0)
      for (const opt of options) {
        expect(opt.id.trim()).not.toBe("")
        expect(opt.label.trim()).not.toBe("")
      }
    }
  })

  it("falls back to the exact locksmith list for null/undefined/empty industry (pre-existing accounts)", () => {
    const nullOptions = resolveJobIntakeOptions(null)
    const undefinedOptions = resolveJobIntakeOptions(undefined)
    const emptyOptions = resolveJobIntakeOptions("")
    const explicitLocksmith = resolveJobIntakeOptions("locksmith")

    expect(nullOptions).toEqual(explicitLocksmith)
    expect(undefinedOptions).toEqual(explicitLocksmith)
    expect(emptyOptions).toEqual(explicitLocksmith)
    expect(explicitLocksmith.map((o) => o.id)).toEqual(SERVICE_QUOTE_TYPES.map((s) => s.id))
  })

  it("plumbing/hvac/electrical use their bespoke category lists, not the registry or generic fallback", () => {
    expect(resolveJobIntakeOptions("plumbing").map((o) => o.id)).toEqual([
      "plumbing_emergency_leak",
      "plumbing_drain_clog",
      "plumbing_water_heater",
      "plumbing_other",
    ])
    expect(resolveJobIntakeOptions("hvac").map((o) => o.id).length).toBe(4)
    expect(resolveJobIntakeOptions("electrical").map((o) => o.id).length).toBe(4)
  })

  it("a registry-backed trade (roofing) gets its own distinct, non-locksmith labels", () => {
    const roofing = resolveJobIntakeOptions("roofing")
    const locksmithLabels = new Set<string>(SERVICE_QUOTE_TYPES.map((s) => s.label))
    expect(roofing.length).toBeGreaterThan(0)
    for (const opt of roofing) {
      expect(locksmithLabels.has(opt.label)).toBe(false)
    }
  })
})

describe("jobIntakeOptionRequiresVehicle (087)", () => {
  it("stays true for locksmith's vehicle-relevant job types", () => {
    expect(jobIntakeOptionRequiresVehicle("locksmith", "lockout")).toBe(true)
    expect(jobIntakeOptionRequiresVehicle("locksmith", "key_generation")).toBe(true)
    expect(jobIntakeOptionRequiresVehicle(null, "lockout")).toBe(true)
  })

  it("is false for locksmith job types that never needed a vehicle", () => {
    expect(jobIntakeOptionRequiresVehicle("locksmith", "rekey")).toBe(false)
    expect(jobIntakeOptionRequiresVehicle("locksmith", "lock_installation")).toBe(false)
  })

  it("is false for every non-vehicle trade's options", () => {
    for (const opt of resolveJobIntakeOptions("plumbing")) {
      expect(jobIntakeOptionRequiresVehicle("plumbing", opt.id)).toBe(false)
    }
    for (const opt of resolveJobIntakeOptions("roofing")) {
      expect(jobIntakeOptionRequiresVehicle("roofing", opt.id)).toBe(false)
    }
  })

  it("is true for auto_repair and towing (the only registry trades that need a vehicle)", () => {
    const autoOptions = resolveJobIntakeOptions("auto_repair")
    expect(autoOptions.length).toBeGreaterThan(0)
    for (const opt of autoOptions) {
      expect(jobIntakeOptionRequiresVehicle("auto_repair", opt.id)).toBe(true)
    }
    const towingOptions = resolveJobIntakeOptions("towing")
    for (const opt of towingOptions) {
      expect(jobIntakeOptionRequiresVehicle("towing", opt.id)).toBe(true)
    }
  })

  it("returns false for an unknown option id instead of throwing", () => {
    expect(jobIntakeOptionRequiresVehicle("plumbing", "not-a-real-id")).toBe(false)
  })
})

describe("isVehicleAwareIndustry (087)", () => {
  it("is true for locksmith and unset (byte-for-byte unchanged default)", () => {
    expect(isVehicleAwareIndustry("locksmith")).toBe(true)
    expect(isVehicleAwareIndustry(null)).toBe(true)
    expect(isVehicleAwareIndustry(undefined)).toBe(true)
    expect(isVehicleAwareIndustry("")).toBe(true)
  })

  it("is true for auto_repair and towing", () => {
    expect(isVehicleAwareIndustry("auto_repair")).toBe(true)
    expect(isVehicleAwareIndustry("towing")).toBe(true)
  })

  it("is false for every other trade", () => {
    for (const industry of AI_INTAKE_PROFILE_IDS) {
      if (["locksmith", "auto_repair", "towing"].includes(industry)) continue
      expect(isVehicleAwareIndustry(industry), `expected "${industry}" to be false`).toBe(false)
    }
  })
})
