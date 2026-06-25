// ============================================
// Interactive owner dispatch SMS
// ============================================
// After a mobile wrap-up finishes, text the business owner a clean, emoji-formatted job dispatch:
// business, customer, phone, the operator's transcribed notes, and a tappable maps link that opens
// the default navigation app on iOS/Android straight to the job site.

import { SITE_NAME } from "@/lib/brand"
import {
  getCallContactByProviderSid,
  getLatestLeadContextForCaller,
  getOnboardingProfile,
  getUser,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { shouldSendAdminLocalJobAssignmentSms } from "@/lib/admin-notification-dispatch"
import { resolveLeadAlertSmsRecipient } from "@/lib/lead-sms-recipient"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

function brandLabel(): string {
  const name = SITE_NAME.trim()
  if (!name) return "Lyncr"
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** Universal Google Maps link — clickable on iOS + Android, opens the default maps/navigation app. */
export function buildMapsLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`
}

function formatPhoneDisplay(phone: string | null): string {
  if (!phone) return "—"
  const d = phone.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}

export type OwnerDispatchData = {
  businessName: string
  customerName: string | null
  customerPhone: string | null
  notes: string | null
  location: string | null
}

/** Compose the formatted owner dispatch SMS (emojis + line breaks + tappable maps link). */
export function buildOwnerDispatchSms(data: OwnerDispatchData): string {
  const brand = brandLabel()
  const lines: string[] = [
    `🔔 ${brand} Job Dispatch`,
    "",
    `🏢 ${data.businessName || "Your business"}`,
    `👤 ${data.customerName?.trim() || "Customer"}`,
    `📞 ${formatPhoneDisplay(data.customerPhone)}`,
  ]
  if (data.notes?.trim()) {
    lines.push("", `📝 Operator notes:`, data.notes.trim())
  }
  if (data.location?.trim()) {
    lines.push("", `📍 Job site: ${data.location.trim()}`, `🗺️ Navigate: ${buildMapsLink(data.location)}`)
  }
  return lines.join("\n")
}

export type OwnerDispatchResult =
  | { ok: true; to: string }
  | { ok: false; reason: string }

/**
 * Resolve the owner's cell + business context and send the dispatch SMS. Pass any known fields;
 * gaps (business name, customer phone/name, location) are filled from the call log + latest lead.
 */
export async function sendOwnerDispatchSms(params: {
  userId: string
  callSid?: string | null
  customerName?: string | null
  customerPhone?: string | null
  location?: string | null
  notes?: string | null
}): Promise<OwnerDispatchResult> {
  const [user, profile] = await Promise.all([getUser(params.userId), getOnboardingProfile(params.userId)])
  if (!user && !profile) return { ok: false, reason: "user not found" }
  if (user && !shouldSendAdminLocalJobAssignmentSms(user)) {
    return { ok: false, reason: "local job assignment SMS disabled in platform notification settings" }
  }

  const recipient = resolveLeadAlertSmsRecipient(profile, user)
  if (!recipient) return { ok: false, reason: "no owner dispatch/cell number configured" }

  let customerPhone = params.customerPhone?.trim() || null
  let customerName = params.customerName?.trim() || null
  let location = params.location?.trim() || null

  // Fill gaps from the call log + the latest captured lead for this caller.
  if (params.callSid && (!customerPhone || !customerName || !location)) {
    const contact = await getCallContactByProviderSid(params.callSid).catch(() => null)
    if (contact) {
      customerPhone = customerPhone || contact.from_number
      customerName = customerName || contact.caller_name
      const leadCtx = await getLatestLeadContextForCaller(params.userId, contact.from_number).catch(() => null)
      if (leadCtx) {
        location = location || leadCtx.location
        customerName = customerName || leadCtx.customerName
      }
    }
  }

  const text = buildOwnerDispatchSms({
    businessName: user?.business_name?.trim() || user?.name?.trim() || "Your business",
    customerName,
    customerPhone: customerPhone ? normalizePhoneNumberE164(customerPhone) || customerPhone : null,
    notes: params.notes ?? null,
    location,
  })

  const sent = await sendTelnyxSms({ toE164: recipient, text, userId: params.userId })
  if (!sent.ok) return { ok: false, reason: sent.error }
  return { ok: true, to: recipient }
}
