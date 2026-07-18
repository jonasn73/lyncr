// Transactional customer SMS when dispatch status moves to en route or on site.

import { SITE_NAME } from "@/lib/brand"
import {
  getLeadDispatchContext,
  getOwnerSmsSettings,
  getOwnerSchedulerEventById,
  getUser,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { vehicleLabelFromParts } from "@/lib/job-pool"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

function brandLabel(): string {
  const name = SITE_NAME.trim()
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Lyncr"
}

async function resolveVehicleLine(leadId: string, ownerUserId: string): Promise<string> {
  const event = await getOwnerSchedulerEventById(ownerUserId, leadId)
  const label = vehicleLabelFromParts(
    event?.vehicle_year ?? null,
    event?.vehicle_make ?? null,
    event?.vehicle_model ?? null
  )
  return label || "vehicle"
}

/** Fire-and-forget safe: returns without throwing on skip/failure. */
export async function sendDispatchEnRouteCustomerSms(params: {
  leadId: string
  expectedOwnerUserId?: string
}): Promise<void> {
  const ctx = await getLeadDispatchContext(params.leadId)
  if (!ctx) return
  if (params.expectedOwnerUserId && ctx.owner_user_id !== params.expectedOwnerUserId) return

  const settings = await getOwnerSmsSettings(ctx.owner_user_id)
  if (settings.sms_route_enabled !== true) return

  const toE164 = ctx.customer_phone ? normalizePhoneNumberE164(ctx.customer_phone) : ""
  if (!isReasonablePstnDialString(toE164)) return

  const owner = await getUser(ctx.owner_user_id)
  const businessName = owner?.business_name?.trim() || brandLabel()
  const text = `${businessName}: Our technician is now en route to your location. You can track real-time status updates from your dispatch console.`

  try {
    const res = await sendTelnyxSms({ toE164, text, userId: ctx.owner_user_id })
    if (!res.ok) {
      console.warn("[dispatch-customer-sms] en_route send failed:", res.error)
    }
  } catch (e) {
    console.error("[dispatch-customer-sms] en_route unexpected failure:", e)
  }
}

/** Customer text when the tech arrives on site (vehicle line from scheduler row). */
export async function sendDispatchOnSiteCustomerSms(params: {
  leadId: string
  expectedOwnerUserId?: string
}): Promise<void> {
  const ctx = await getLeadDispatchContext(params.leadId)
  if (!ctx) return
  if (params.expectedOwnerUserId && ctx.owner_user_id !== params.expectedOwnerUserId) return

  const toE164 = ctx.customer_phone ? normalizePhoneNumberE164(ctx.customer_phone) : ""
  if (!isReasonablePstnDialString(toE164)) return

  const owner = await getUser(ctx.owner_user_id)
  const businessName = owner?.business_name?.trim() || brandLabel()
  const vehicle = await resolveVehicleLine(params.leadId, ctx.owner_user_id)
  const text = `${businessName}: Our technician has arrived on-site and is beginning service on your ${vehicle}.`

  try {
    const res = await sendTelnyxSms({ toE164, text, userId: ctx.owner_user_id })
    if (!res.ok) {
      console.warn("[dispatch-customer-sms] on_site send failed:", res.error)
    }
  } catch (e) {
    console.error("[dispatch-customer-sms] on_site unexpected failure:", e)
  }
}
