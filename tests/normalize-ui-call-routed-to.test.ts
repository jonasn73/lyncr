import { describe, expect, it } from "vitest"
import { normalizeUiCallRoutedTo } from "@/lib/hooks/use-operations-data"

describe("normalizeUiCallRoutedTo", () => {
  it("does not relabel a failed press-1 booking text as AI Receptionist", () => {
    // Regression: "failed" contains the substring "ai" (f-AI-led) — a bare .includes("ai")
    // check silently hid this exact failure from the Activity list.
    expect(normalizeUiCallRoutedTo("Booked from hold · press 1 (text failed)")).toBe(
      "Booked from hold · press 1 (text failed)"
    )
  })

  it("does not relabel other ordinary words containing 'ai'", () => {
    expect(normalizeUiCallRoutedTo("Answered from queue")).toBe("Answered from queue")
    expect(normalizeUiCallRoutedTo("Owner")).toBe("Owner")
    expect(normalizeUiCallRoutedTo("Detail requested")).toBe("Detail requested")
  })

  it("collapses real AI-handled labels to 'AI Receptionist'", () => {
    expect(normalizeUiCallRoutedTo("AI Receptionist")).toBe("AI Receptionist")
    expect(normalizeUiCallRoutedTo("Voice AI")).toBe("AI Receptionist")
    expect(normalizeUiCallRoutedTo("AI Assistant (from hold)")).toBe("AI Receptionist")
  })

  it("does not relabel a human assistant handoff", () => {
    expect(normalizeUiCallRoutedTo("Human assistant")).toBe("Human assistant")
  })
})
