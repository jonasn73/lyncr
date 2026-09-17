import { describe, expect, it } from "vitest"
import {
  holdQueueIntakeValidDigits,
  isUrgentHoldQueueIntentSlug,
  resolveHoldQueueIntakePrompt,
} from "@/lib/hold-queue-intake-prompts"
import { resolveJobIntakeOptions } from "@/lib/job-intake-registry"

const CONFIGURED_INDUSTRIES = ["locksmith", "auto_repair", "towing", "roofing", "plumbing", "hvac", "electrical"]

describe("resolveHoldQueueIntakePrompt", () => {
  it("returns a prompt for every configured industry", () => {
    for (const industry of CONFIGURED_INDUSTRIES) {
      expect(resolveHoldQueueIntakePrompt(industry)).not.toBeNull()
    }
  })

  it("returns null for unconfigured industries and empty input", () => {
    expect(resolveHoldQueueIntakePrompt("dental")).toBeNull()
    expect(resolveHoldQueueIntakePrompt(null)).toBeNull()
    expect(resolveHoldQueueIntakePrompt(undefined)).toBeNull()
    expect(resolveHoldQueueIntakePrompt("")).toBeNull()
  })

  it("assigns each option a unique digit that matches holdQueueIntakeValidDigits", () => {
    for (const industry of CONFIGURED_INDUSTRIES) {
      const prompt = resolveHoldQueueIntakePrompt(industry)!
      const digits = prompt.options.map((o) => o.digit)
      expect(new Set(digits).size).toBe(digits.length)
      expect(holdQueueIntakeValidDigits(prompt)).toBe(digits.join(""))
    }
  })

  // Locksmith's intentSlugs are deliberately informational-only (see the comment in
  // hold-queue-intake-prompts.ts) — every other bespoke/registry industry's option
  // intentSlug must line up with a real resolveJobIntakeOptions id so the caller's
  // hold-queue answer can auto-fill the manual-intake job-type dropdown.
  it("hvac and electrical intentSlugs match real job-intake-registry option ids", () => {
    for (const industry of ["hvac", "electrical", "plumbing"]) {
      const prompt = resolveHoldQueueIntakePrompt(industry)!
      const optionIds = resolveJobIntakeOptions(industry).map((o) => o.id)
      for (const option of prompt.options) {
        expect(optionIds).toContain(option.intentSlug)
      }
    }
  })

  it("flags no-heat, no-cooling, and electrical safety concerns as urgent", () => {
    const hvac = resolveHoldQueueIntakePrompt("hvac")!
    expect(hvac.options.find((o) => o.intentSlug === "hvac_no_heat")?.urgent).toBe(true)
    expect(hvac.options.find((o) => o.intentSlug === "hvac_no_cooling")?.urgent).toBe(true)
    expect(hvac.options.find((o) => o.intentSlug === "hvac_other")?.urgent).toBeFalsy()

    const electrical = resolveHoldQueueIntakePrompt("electrical")!
    expect(electrical.options.find((o) => o.intentSlug === "electrical_safety")?.urgent).toBe(true)
    expect(electrical.options.find((o) => o.intentSlug === "electrical_partial_power")?.urgent).toBeFalsy()
  })
})

describe("isUrgentHoldQueueIntentSlug", () => {
  it("recognizes urgent intents across industries", () => {
    expect(isUrgentHoldQueueIntentSlug("hvac_no_heat")).toBe(true)
    expect(isUrgentHoldQueueIntentSlug("hvac_no_cooling")).toBe(true)
    expect(isUrgentHoldQueueIntentSlug("electrical_safety")).toBe(true)
    expect(isUrgentHoldQueueIntentSlug("locksmith_lockout")).toBe(true)
  })

  it("returns false for non-urgent or unknown intents", () => {
    expect(isUrgentHoldQueueIntentSlug("hvac_other")).toBe(false)
    expect(isUrgentHoldQueueIntentSlug("electrical_partial_power")).toBe(false)
    expect(isUrgentHoldQueueIntentSlug(null)).toBe(false)
    expect(isUrgentHoldQueueIntentSlug(undefined)).toBe(false)
    expect(isUrgentHoldQueueIntentSlug("")).toBe(false)
  })
})
