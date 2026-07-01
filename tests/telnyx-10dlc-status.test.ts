import { describe, expect, it } from "vitest"
import { formatTelnyxRegistryText, normalizeTelnyxRegistryStatus } from "@/lib/telnyx-10dlc"

describe("formatTelnyxRegistryText", () => {
  it("returns null for [object Object] strings", () => {
    expect(formatTelnyxRegistryText("[object Object]")).toBeNull()
  })

  it("extracts nested failure reason objects", () => {
    expect(formatTelnyxRegistryText({ description: "Sample messages missing STOP language." })).toBe(
      "Sample messages missing STOP language."
    )
  })

  it("joins array failure reasons", () => {
    expect(formatTelnyxRegistryText(["Invalid sample", "Missing opt-in flow"])).toBe(
      "Invalid sample; Missing opt-in flow"
    )
  })
})

describe("normalizeTelnyxRegistryStatus", () => {
  it("treats TCR_FAILED as rejected", () => {
    expect(normalizeTelnyxRegistryStatus("TCR_FAILED")).toBe("rejected")
  })

  it("treats MNO_PROVISIONED as approved", () => {
    expect(normalizeTelnyxRegistryStatus("MNO_PROVISIONED")).toBe("approved")
  })

  it("treats TCR_PENDING as pending review", () => {
    expect(normalizeTelnyxRegistryStatus("TCR_PENDING")).toBe("pending_review")
  })

  it("treats TELNYX_FAILED as rejected", () => {
    expect(normalizeTelnyxRegistryStatus("TELNYX_FAILED")).toBe("rejected")
  })
})
