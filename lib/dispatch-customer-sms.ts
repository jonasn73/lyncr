// Transactional customer SMS when dispatch status moves (en route / on site / paused).

import { SITE_NAME } from "@/lib/brand"
import {
  getLeadDispatchContext,
  getOwnerSmsSettings,
  getUser,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { renderTemplate } from "@/lib/sms-pipeline"
import { DEFAULT_SMS_STATUS_TEMPLATES, renderStatusSms } from "@/lib/sms-status-templates"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import type { OwnerSmsSettings } from "@/lib/types"

function brandLabel(): string {
  const name = SITE_NAME.trim()
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Lyncr"
}

async function loadCtx(params: { leadId: string; expectedOwnerUserId?: string }) {
  const ctx = await getLeadDispatchContext(params.leadId)
  if (!ctx) return null
  if (params.expectedOwnerUserId && ctx.owner_user_id !== params.expectedOwnerUserId) return null
  const toE164 = ctx.customer_phone ? normalizePhoneNumberE164(ctx.customer_phone) : ""
  if (!isReasonablePstnDialString(toE164)) return null
  const owner = await getUser(ctx.owner_user_id)
  const settings = await getOwnerSmsSettings(ctx.owner_user_id)
  const businessName = owner?.business_name?.trim() || brandLabel()
  return { ctx, toE164, settings, businessName }
}

async function sendText(userId: string, toE164: string, text: string, logLabel: string) {
  const body = text.trim()
  if (!body) return
  try {
    const res = await sendTelnyxSms({ toE164, text: body, userId })
    if (!res.ok) {
      console.warn(`[dispatch-customer-sms] ${logLabel} send failed:`, res.error)
    }
  } catch (e) {
    console.error(`[dispatch-customer-sms] ${logLabel} unexpected failure:`, e)
  }
}

/** Fire-and-forget safe: returns without throwing on skip/failure. */
export async function sendDispatchEnRouteCustomerSms(params: {
  leadId: string
  expectedOwnerUserId?: string
}): Promise<void> {
  const loaded = await loadCtx(params)
  if (!loaded) return
  const { ctx, toE164, settings, businessName } = loaded
  if (settings.sms_route_enabled !== true) return

  const template =
    settings.sms_route_template?.trim() ||
    "Hi {{customer_name}}, your {{business_name}} technician is on the way. See you soon!"
  const text = renderTemplate(template, {
    customer_name: ctx.customer_name?.trim() || "there",
    business_name: businessName,
    tech_name: "your technician",
    time_slot: "",
    review_url: "",
  })
  await sendText(ctx.owner_user_id, toE164, text, "en_route")
}

/** Customer text when the tech arrives on site. */
export async function sendDispatchOnSiteCustomerSms(params: {
  leadId: string
  expectedOwnerUserId?: string
}): Promise<void> {
  const loaded = await loadCtx(params)
  if (!loaded) return
  const { ctx, toE164, settings, businessName } = loaded
  const text = renderStatusSms(
    settings.sms_status_templates?.arrived || DEFAULT_SMS_STATUS_TEMPLATES.arrived,
    { customer_name: ctx.customer_name, business_name: businessName }
  )
  await sendText(ctx.owner_user_id, toE164, text, "on_site")
}

/** Customer text when the tech pauses on site (will return shortly). */
export async function sendDispatchPausedWaitCustomerSms(params: {
  leadId: string
  expectedOwnerUserId?: string
}): Promise<void> {
  const loaded = await loadCtx(params)
  if (!loaded) return
  const { ctx, toE164, settings, businessName } = loaded
  const text = renderStatusSms(
    settings.sms_status_templates?.paused_wait || DEFAULT_SMS_STATUS_TEMPLATES.paused_wait,
    { customer_name: ctx.customer_name, business_name: businessName }
  )
  await sendText(ctx.owner_user_id, toE164, text, "paused_wait")
}

/** Customer text when the job is paused waiting on a part. */
export async function sendDispatchPausedPartsCustomerSms(params: {
  leadId: string
  expectedOwnerUserId?: string
}): Promise<void> {
  const loaded = await loadCtx(params)
  if (!loaded) return
  const { ctx, toE164, settings, businessName } = loaded
  const text = renderStatusSms(
    settings.sms_status_templates?.paused_parts || DEFAULT_SMS_STATUS_TEMPLATES.paused_parts,
    { customer_name: ctx.customer_name, business_name: businessName }
  )
  await sendText(ctx.owner_user_id, toE164, text, "paused_parts")
}

/** Build a late SMS from the owner's saved late template (composer / one-tap). */
export function buildLateStatusSmsFromSettings(
  settings: Pick<OwnerSmsSettings, "sms_status_templates"> | null | undefined,
  vars: { customerName?: string | null; businessName?: string | null; etaMinutes: number }
): string {
  const template = settings?.sms_status_templates?.late || DEFAULT_SMS_STATUS_TEMPLATES.late
  return renderStatusSms(template, {
    customer_name: vars.customerName,
    business_name: vars.businessName,
    eta_minutes: vars.etaMinutes,
  })
}
