import { describe, expect, it } from "vitest"
import { calculateTechETA, sortTechsByProximityEta } from "@/lib/dispatch-eta"
import { appendAiTranscriptDraftToNotes, AI_TRANSCRIPT_DRAFT_BULLET } from "@/lib/call-transcript-stub"
import { buildDepositSmsStagingTemplate, createMockSecureDepositLink } from "@/lib/secure-deposit-link"

describe("calculateTechETA", () => {
  it("returns null when either pin is missing", () => {
    expect(calculateTechETA(null, { lat: 40, lng: -74 })).toBeNull()
    expect(calculateTechETA({ lat: 40, lng: -74 }, null)).toBeNull()
  })

  it("estimates miles and minutes between two points", () => {
    const eta = calculateTechETA(
      { lat: 40.7128, lng: -74.006 },
      { lat: 40.758, lng: -73.9855 }
    )
    expect(eta).not.toBeNull()
    expect(eta!.straightLineMiles).toBeGreaterThan(0)
    expect(eta!.etaMinutes).toBeGreaterThan(0)
    expect(eta!.label).toMatch(/mi/)
  })

  it("sorts techs nearest-first for intake dispatch", () => {
    const job = { lat: 40.7128, lng: -74.006 }
    const techs = [
      { id: "far", pin: { lat: 40.9, lng: -73.8 } },
      { id: "near", pin: { lat: 40.72, lng: -74.0 } },
      { id: "mid", pin: { lat: 40.78, lng: -73.95 } },
    ]
    const sorted = sortTechsByProximityEta(techs, job, (t) => t.pin)
    expect(sorted.map((t) => t.id)).toEqual(["near", "mid", "far"])
  })
})

describe("secure deposit stub", () => {
  it("builds a pay.lyncr.app mock URL and SMS staging body", () => {
    const url = createMockSecureDepositLink("abc-123")
    expect(url).toMatch(/^https:\/\/pay\.lyncr\.app\/d\//)
    const sms = buildDepositSmsStagingTemplate({
      customerName: "Alex",
      depositUrl: url,
      amountLabel: "$50",
    })
    expect(sms).toContain("Alex")
    expect(sms).toContain(url)
    expect(sms).toContain("$50")
  })
})

describe("AI transcript draft notes", () => {
  it("appends the placeholder once", () => {
    const once = appendAiTranscriptDraftToNotes("Gate code 12")
    expect(once).toContain(AI_TRANSCRIPT_DRAFT_BULLET)
    const twice = appendAiTranscriptDraftToNotes(once)
    expect(twice).toBe(once)
  })
})
