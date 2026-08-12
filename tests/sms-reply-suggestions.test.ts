import { describe, expect, it } from "vitest"
import {
  buildHeuristicSmsReplySuggestions,
  buildJobFinishedFollowUpChips,
  detectSmsReplyIntent,
  extractBusinessNameFromSmsBody,
  extractVehicleFromSmsBody,
} from "@/lib/sms-reply-suggestions"

describe("sms reply suggestions", () => {
  it("detects cancel / no longer needed intent", () => {
    expect(
      detectSmsReplyIntent(
        "Found a different solution so no longer needed. Thank you for the follow-up"
      )
    ).toBe("cancel")
    expect(detectSmsReplyIntent("Please cancel my appointment")).toBe("cancel")
    expect(detectSmsReplyIntent("We went with someone else")).toBe("cancel")
  })

  it("detects schedule and generic intents", () => {
    expect(detectSmsReplyIntent("Can you come tomorrow morning?")).toBe("schedule")
    expect(detectSmsReplyIntent("Thanks!")).toBe("thanks")
    expect(detectSmsReplyIntent("How much for a spare key?")).toBe("question")
    expect(detectSmsReplyIntent("Ok")).toBe("generic")
  })

  it("extracts vehicle and business from outbound copy", () => {
    expect(
      extractVehicleFromSmsBody(
        "Hi Ken Cook, just checking in regarding your quote for the 2023 Ford Expedition."
      )
    ).toBe("2023 Ford Expedition")
    expect(
      extractBusinessNameFromSmsBody("Key Squad 502 — pick a time: https://lyncr.app/b/x")
    ).toBe("Key Squad 502")
  })

  it("builds cancel chips with business name and never auto-sends", () => {
    const result = buildHeuristicSmsReplySuggestions({
      customerMessage:
        "Found a different solution so no longer needed. Thank you for the follow-up",
      customerName: "Ken Cook",
      businessName: "Key Squad 502",
      priorOutbound:
        "Hi Ken Cook, just checking in regarding your quote for the 2023 Ford Expedition.",
    })
    expect(result.intent).toBe("cancel")
    expect(result.chips.length).toBeGreaterThanOrEqual(2)
    expect(result.chips.length).toBeLessThanOrEqual(4)
    expect(result.drafts.length).toBeGreaterThanOrEqual(1)
    expect(result.chips.some((c) => /Key Squad 502/.test(c.body))).toBe(true)
    expect(result.chips.every((c) => c.body.trim().length > 0)).toBe(true)
    expect(result.source).toBe("heuristic")
  })

  it("builds compact job-finished follow-up chips", () => {
    const chips = buildJobFinishedFollowUpChips({
      customerName: "Nathaniel Thompson",
      businessName: "Key Squad 502",
    })
    expect(chips.length).toBe(3)
    expect(chips[0]?.label).toBe("Thanks again")
    expect(chips.every((c) => c.body.includes("Nathaniel") || c.body.includes("Key Squad"))).toBe(
      true
    )
  })
})
