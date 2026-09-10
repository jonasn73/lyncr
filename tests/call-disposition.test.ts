import { describe, expect, it, vi, beforeEach } from "vitest"

const insertAiLead = vi.fn()
const applyLeadDisposition = vi.fn()
const setCallLogDisposition = vi.fn()
const publishOwnerEvent = vi.fn()
const attributeLeadToCallReceptionist = vi.fn()

vi.mock("@/lib/db", () => ({
  insertAiLead: (...a: unknown[]) => insertAiLead(...a),
  applyLeadDisposition: (...a: unknown[]) => applyLeadDisposition(...a),
  setCallLogDisposition: (...a: unknown[]) => setCallLogDisposition(...a),
}))
vi.mock("@/lib/realtime/pusher-server", () => ({
  publishOwnerEvent: (...a: unknown[]) => publishOwnerEvent(...a),
}))
vi.mock("@/lib/create-intake-job", () => ({
  attributeLeadToCallReceptionist: (...a: unknown[]) => attributeLeadToCallReceptionist(...a),
}))

import { recordOperatorDisposition } from "@/lib/call-disposition"

beforeEach(() => {
  vi.clearAllMocks()
  insertAiLead.mockResolvedValue("lead-1")
  applyLeadDisposition.mockResolvedValue(undefined)
  setCallLogDisposition.mockResolvedValue(undefined)
  publishOwnerEvent.mockResolvedValue(undefined)
  attributeLeadToCallReceptionist.mockResolvedValue(undefined)
})

describe("recordOperatorDisposition", () => {
  it("attributes the lead to the call's receptionist when a callLogId is present (SMS reply / phone wrapup path)", async () => {
    const result = await recordOperatorDisposition({
      userId: "owner-1",
      disposition: "BOOKED",
      providerCallSid: "sid-abc",
      callLogId: "call-log-1",
      callerNumber: "+15025551234",
      operatorName: "Dana",
      receptionistId: "recv-1",
      source: "sms_reply",
    })

    expect(result).toEqual({ leadId: "lead-1" })
    expect(attributeLeadToCallReceptionist).toHaveBeenCalledTimes(1)
    expect(attributeLeadToCallReceptionist).toHaveBeenCalledWith("lead-1", "owner-1", "call-log-1")
  })

  it("skips attribution when no callLogId is available (owner's own quick-log path)", async () => {
    await recordOperatorDisposition({
      userId: "owner-1",
      disposition: "FAILED",
      callerNumber: "+15025551234",
      source: "activity_missed_quick_log",
    })

    expect(attributeLeadToCallReceptionist).not.toHaveBeenCalled()
  })

  it("still records the disposition and broadcasts even though attribution is separate", async () => {
    await recordOperatorDisposition({
      userId: "owner-1",
      disposition: "PRICE_REJECTED",
      callLogId: "call-log-2",
      source: "voice_wrapup",
    })

    expect(applyLeadDisposition).toHaveBeenCalledWith("lead-1", {
      disposition: "PRICE_REJECTED",
      dispatch_status: "salvage_pending",
      is_salvageable: true,
    })
    expect(publishOwnerEvent).toHaveBeenCalledWith(
      "owner-1",
      "lead-salvageable",
      expect.objectContaining({ leadId: "lead-1" })
    )
  })
})
