import { describe, expect, it } from "vitest"
import { parseVehicleFromTranscript } from "@/lib/vehicle-transcript-parse"

describe("parseVehicleFromTranscript", () => {
  it("parses a clean make and model", () => {
    expect(parseVehicleFromTranscript("Toyota Camry")).toEqual({
      make: "Toyota",
      model: "Camry",
      year: null,
      cleaned: "Toyota Camry",
    })
  })

  it("captures the year from a full spoken answer, keeping it out of the model", () => {
    const parsed = parseVehicleFromTranscript("uh, it's a 2015 toyota camry.")
    expect(parsed?.year).toBe("2015")
    expect(parsed?.make).toBe("Toyota")
    expect(parsed?.model).toBe("Camry")
  })

  it("understands spoken-word years", () => {
    expect(parseVehicleFromTranscript("twenty fifteen toyota camry")?.year).toBe("2015")
    expect(parseVehicleFromTranscript("two thousand and eight honda civic")?.year).toBe("2008")
    expect(parseVehicleFromTranscript("nineteen ninety-nine ford ranger")?.year).toBe("1999")
    expect(parseVehicleFromTranscript("twenty oh five chevy malibu")?.year).toBe("2005")
    expect(parseVehicleFromTranscript("twenty twenty-two kia telluride")?.year).toBe("2022")
  })

  it("returns a year even when no make matched", () => {
    expect(parseVehicleFromTranscript("2015")).toEqual({
      make: null,
      model: null,
      year: "2015",
      cleaned: "",
    })
  })

  it("resolves aliases to canonical makes", () => {
    expect(parseVehicleFromTranscript("chevy silverado")?.make).toBe("Chevrolet")
    expect(parseVehicleFromTranscript("chevy silverado")?.model).toBe("Silverado")
    expect(parseVehicleFromTranscript("VW Jetta")?.make).toBe("Volkswagen")
    expect(parseVehicleFromTranscript("a mercedes c300")?.make).toBe("Mercedes-Benz")
  })

  it("keeps multi-word models, capped at three words", () => {
    const parsed = parseVehicleFromTranscript("ford f 150 super duty crew cab")
    expect(parsed?.make).toBe("Ford")
    expect(parsed?.model).toBe("F 150 Super")
  })

  it("matches multi-word makes before shorter overlaps", () => {
    const parsed = parseVehicleFromTranscript("land rover discovery")
    expect(parsed?.make).toBe("Land Rover")
    expect(parsed?.model).toBe("Discovery")
  })

  it("never invents structure from an unmatched transcript", () => {
    const parsed = parseVehicleFromTranscript("silver pickup with a camper shell")
    expect(parsed?.make).toBeNull()
    expect(parsed?.model).toBeNull()
    expect(parsed?.cleaned).toBe("silver pickup with a camper shell")
  })

  it("returns null for empty or filler-only clips", () => {
    expect(parseVehicleFromTranscript("")).toBeNull()
    expect(parseVehicleFromTranscript(null)).toBeNull()
    expect(parseVehicleFromTranscript("uh... um")).toBeNull()
  })
})

// The completeness-check resolver lives beside the intake prompts (pure, no deps).
import { resolveHoldVehicleVoiceStep } from "@/lib/hold-queue-intake-prompts"

const baseStep = {
  isVehicleIntent: true,
  attempts: 1,
  confirmed: false,
  confirmAsks: 0,
  transcriptionPending: false,
  pendingIsStale: false,
  capturedMake: null as string | null,
  zipFallbackAnswered: false,
}

describe("resolveHoldVehicleVoiceStep", () => {
  it("reads a good capture back exactly once", () => {
    expect(resolveHoldVehicleVoiceStep({ ...baseStep, capturedMake: "Toyota" })).toBe("confirm")
    expect(
      resolveHoldVehicleVoiceStep({ ...baseStep, capturedMake: "Toyota", confirmAsks: 1 })
    ).toBe("zip_fallback")
    expect(
      resolveHoldVehicleVoiceStep({ ...baseStep, capturedMake: "Toyota", confirmed: true })
    ).toBe("none")
  })

  it("retries a failed capture once, then asks for ZIP", () => {
    expect(resolveHoldVehicleVoiceStep(baseStep)).toBe("retry")
    expect(resolveHoldVehicleVoiceStep({ ...baseStep, attempts: 2 })).toBe("zip_fallback")
    expect(resolveHoldVehicleVoiceStep({ ...baseStep, attempts: 2, zipFallbackAnswered: true })).toBe("none")
  })

  it("asks when the clip never ran at all", () => {
    expect(resolveHoldVehicleVoiceStep({ ...baseStep, attempts: 0 })).toBe("ask")
  })

  it("asks ZIP after an unconfirmed capture", () => {
    expect(
      resolveHoldVehicleVoiceStep({
        ...baseStep,
        capturedMake: "Toyota",
        confirmAsks: 1,
      })
    ).toBe("zip_fallback")
    expect(
      resolveHoldVehicleVoiceStep({
        ...baseStep,
        confirmed: true,
      })
    ).toBe("none")
  })

  it("waits while transcription is in flight, but not forever", () => {
    expect(
      resolveHoldVehicleVoiceStep({ ...baseStep, transcriptionPending: true })
    ).toBe("none")
    expect(
      resolveHoldVehicleVoiceStep({
        ...baseStep,
        transcriptionPending: true,
        pendingIsStale: true,
      })
    ).toBe("retry")
  })

  it("never fires for a non-vehicle intake", () => {
    expect(resolveHoldVehicleVoiceStep({ ...baseStep, isVehicleIntent: false })).toBe("none")
  })
})
