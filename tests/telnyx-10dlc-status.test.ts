import { describe, expect, it } from "vitest"
import { normalizeTelnyxRegistryStatus } from "@/lib/telnyx-10dlc"

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
