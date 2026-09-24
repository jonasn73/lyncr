import { beforeEach, describe, expect, it, vi } from "vitest"

const { getInvite, recordForm, gatherStop } = vi.hoisted(() => ({
  getInvite: vi.fn(),
  recordForm: vi.fn(),
  gatherStop: vi.fn(),
}))

vi.mock("@/lib/booking-invite", () => ({ getBookingInviteById: getInvite }))
vi.mock("@/lib/call-queue-db", () => ({ recordBookingFormOnActiveHold: recordForm }))
vi.mock("@/lib/telnyx-call-control-api", () => ({ telnyxCallControlGatherStop: gatherStop }))

import { notifyLiveHoldOfBookingSubmission } from "@/lib/booking-live-hold"

const submission = {
  inviteId: "invite-1",
  ownerUserId: "owner-1",
  callerE164: "+15025559999",
  businessLineE164: "+15025551219",
  leadId: "lead-1",
  customerName: "Alex",
  jobType: "Lost key",
}

beforeEach(() => {
  vi.clearAllMocks()
  getInvite.mockResolvedValue({
    ownerUserId: submission.ownerUserId,
    callerPhone: submission.callerE164,
    businessLine: submission.businessLineE164,
  })
  recordForm.mockResolvedValue("cc-live")
  gatherStop.mockResolvedValue({ ok: true })
})

describe("completed booking form on a live hold call", () => {
  it("records the lead and wakes the matching call", async () => {
    await notifyLiveHoldOfBookingSubmission(submission)
    expect(recordForm).toHaveBeenCalledWith(submission)
    expect(gatherStop).toHaveBeenCalledWith("cc-live")
  })

  it("uses the invite caller when the customer edits the form's contact number", async () => {
    getInvite.mockResolvedValue({
      ownerUserId: submission.ownerUserId,
      callerPhone: "+15025558888",
      businessLine: submission.businessLineE164,
    })
    await notifyLiveHoldOfBookingSubmission(submission)
    expect(recordForm).toHaveBeenCalledWith({ ...submission, callerE164: "+15025558888" })
    expect(gatherStop).toHaveBeenCalledWith("cc-live")
  })

  it("does not wake a call belonging to another business line", async () => {
    getInvite.mockResolvedValue({
      ownerUserId: submission.ownerUserId,
      callerPhone: submission.callerE164,
      businessLine: "+15025550000",
    })
    await notifyLiveHoldOfBookingSubmission(submission)
    expect(recordForm).not.toHaveBeenCalled()
    expect(gatherStop).not.toHaveBeenCalled()
  })
})
