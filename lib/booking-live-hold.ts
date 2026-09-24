import { getBookingInviteById } from "@/lib/booking-invite"
import { recordBookingFormOnActiveHold } from "@/lib/call-queue-db"
import { telnyxCallControlGatherStop } from "@/lib/telnyx-call-control-api"

/** A valid invite may wake only its own caller's current hold call. */
export async function notifyLiveHoldOfBookingSubmission(params: {
  inviteId: string
  ownerUserId: string
  callerE164: string
  businessLineE164: string
  leadId: string
  customerName: string
  jobType: string
}): Promise<void> {
  if (!params.inviteId) return
  const invite = await getBookingInviteById(params.inviteId).catch(() => null)
  if (
    !invite ||
    invite.ownerUserId !== params.ownerUserId ||
    !invite.callerPhone ||
    invite.businessLine !== params.businessLineE164
  ) return

  const callControlId = await recordBookingFormOnActiveHold({
    ...params,
    // The customer may edit the form's contact number. The invitation itself
    // identifies the phone that is still on hold.
    callerE164: invite.callerPhone,
  })
  if (callControlId) {
    // Ends the current music gather; its webhook reads the saved form and speaks
    // acknowledgment before returning to hold. If the command fails, the next
    // scheduled gather timeout still notices the form.
    await telnyxCallControlGatherStop(callControlId).catch(() => undefined)
  }
}
