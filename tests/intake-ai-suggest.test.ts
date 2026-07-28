import { describe, expect, it } from "vitest"
import {
  buildHeuristicIntakeSuggestion,
  inferServiceTypeFromText,
} from "@/lib/intake-ai-suggest"

describe("intake AI suggest", () => {
  it("infers service types from free text", () => {
    expect(inferServiceTypeFromText("Customer locked out of car")).toBe("lockout")
    expect(inferServiceTypeFromText("Need a spare key duplicate")).toBe("key_duplication")
    expect(inferServiceTypeFromText("All keys lost — need new key")).toBe("key_generation")
    expect(inferServiceTypeFromText("Ignition will not turn")).toBe("ignition_repair")
  })

  it("prefills from open quote + CRM without auto-booking", () => {
    const suggestion = buildHeuristicIntakeSuggestion({
      customerName: "Alex",
      customerNotes: "Prefers mornings",
      openServiceTypeId: "key_duplication",
      openQuoteCents: 12500,
      vehicleYear: "2018",
      vehicleMake: "Honda",
      vehicleModel: "Civic",
      notes: "",
    })
    expect(suggestion.serviceTypeId).toBe("key_duplication")
    expect(suggestion.suggestedPriceCents).toBe(12500)
    expect(suggestion.notesDraft).toContain("confirm before booking")
    expect(suggestion.notesDraft).toContain("Alex")
    expect(suggestion.notesDraft).toContain("$125")
    expect(suggestion.source).toBe("heuristic")
  })

  it("lets call-context text override open service when clearer", () => {
    const suggestion = buildHeuristicIntakeSuggestion({
      openServiceTypeId: "other",
      openQuoteCents: null,
      callContext: "Caller says keys locked in the trunk",
    })
    expect(suggestion.serviceTypeId).toBe("lockout")
  })
})
