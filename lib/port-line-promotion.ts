// When a port completes, make that DID the workspace main line customers should call.

import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  clearIncomingRoutingCache,
  getOnboardingProfile,
  normalizePhoneNumberE164,
  updateOnboardingProfile,
} from "@/lib/db"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"

/** Point onboarding + inbound routing at the newly ported public number. */
export async function promotePortedLineAsPrimary(params: {
  ownerUserId: string
  phoneNumberE164: string
}): Promise<boolean> {
  const e164 = normalizePhoneNumberE164(params.phoneNumberE164.trim())
  if (!e164) return false

  const profile = await getOnboardingProfile(params.ownerUserId)
  const current = profile?.reserved_number?.trim()
    ? normalizePhoneNumberE164(profile.reserved_number)
    : null

  if (current === e164) return false

  await updateOnboardingProfile(params.ownerUserId, {
    reserved_number: e164,
    reserved_number_display: formatPhoneDisplay(e164),
    reserved_number_method: "port",
  })
  clearIncomingRoutingCache()

  void publishOwnerEvent(params.ownerUserId, "porting-update", {
    organization_id: null,
    promoted_primary_line: e164,
  })

  console.log(
    JSON.stringify({
      lyncr: "port-line-promotion",
      userId: params.ownerUserId,
      primary_line: e164,
      previous_reserved: current,
    })
  )

  return true
}
