// Booking confirmation SMS to the caller after answered-call intake creates a job.

import { SITE_NAME } from "@/lib/brand"
import {
  getPhoneNumbers,
  getUser,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { sendAndLogWorkspaceCustomerSms } from "@/lib/workspace-customer-sms"

const CANCELLATION_POLICY =
  "Cancellations within 5 minutes of dispatch: no charge. After that, a fee may apply."

/** Resolve a business DID for From + logging (call line → first owned line). */
async function resolveBusinessLine(params: {
  ownerUserId: string
  businessLine?: string | null
  callLogId?: string | null
}): Promise<string | null> {
  const fromArg = (params.businessLine ?? "").trim()
  if (fromArg) {
    return normalizePhoneNumberE164(fromArg) || fromArg
  }

  if (params.callLogId?.trim()) {
    try {
      const sql = neon(resolveNeonDatabaseUrl())
      const rows = await sql`
        SELECT to_number
        FROM call_logs
        WHERE id = ${params.callLogId.trim()}::uuid AND user_id = ${params.ownerUserId}
        LIMIT 1
      `
      const to = String(rows[0]?.to_number ?? "").trim()
      if (to) return normalizePhoneNumberE164(to) || to
    } catch {
      /* call log lookup is best-effort */
    }
  }

  try {
    const lines = await getPhoneNumbers(params.ownerUserId)
    const active = lines.find((n) => (n.status || "").toLowerCase() === "active") || lines[0]
    const num = active?.number?.trim()
    if (num) return normalizePhoneNumberE164(num) || num
  } catch {
    /* phone list optional */
  }
  return null
}

/** Human-readable appointment time for SMS (US-friendly). */
export function formatAppointmentSmsTime(scheduledAtIso: string | null | undefined): string | null {
  const raw = (scheduledAtIso ?? "").trim()
  if (!raw) return null
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return null
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toLocaleString("en-US")
  }
}

export function buildIntakeBookingCustomerSmsText(params: {
  customerName: string
  businessName: string
  scheduledAtIso?: string | null
  /** Preferred window / ASAP label — preferred over inventing an exact pin time. */
  availabilityLabel?: string | null
  isAsap?: boolean
  serviceAddress?: string | null
  jobType?: string | null
}): string {
  const first = params.customerName.split(/\s+/)[0]?.trim() || "there"
  const business = params.businessName.trim() || SITE_NAME
  const asap = params.isAsap === true
  const windowLabel = (params.availabilityLabel ?? "").trim()
  const when =
    asap || windowLabel
      ? null
      : formatAppointmentSmsTime(params.scheduledAtIso)
  const address = (params.serviceAddress ?? "").trim()
  const job = (params.jobType ?? "").trim()

  let body = `Hi ${first}, ${business}`
  if (asap) {
    body += " got your ASAP request. We'll call or text to confirm when we can get there"
  } else if (windowLabel) {
    body += ` received your request. You're free: ${windowLabel}. We'll confirm`
  } else if (when) {
    body += ` received your request for ${when}. We'll confirm shortly`
  } else {
    body += " received your request. We'll confirm shortly"
  }
  body += "."
  if (address) body += ` Location: ${address}.`
  if (job) body += ` Service: ${job}.`
  body += ` Reply here if anything changes.\n\n${CANCELLATION_POLICY}`
  return body
}

export async function sendIntakeBookingCustomerSms(params: {
  ownerUserId: string
  leadId: string
  customerPhoneE164: string
  customerName: string
  businessLine?: string | null
  callLogId?: string | null
  organizationId?: string | null
  scheduledAtIso?: string | null
  availabilityLabel?: string | null
  isAsap?: boolean
  serviceAddress?: string | null
  jobType?: string | null
}): Promise<{ sent: boolean; error: string | null }> {
  const toE164 = normalizePhoneNumberE164(params.customerPhoneE164)
  if (!isReasonablePstnDialString(toE164)) {
    return { sent: false, error: "Invalid customer phone number." }
  }

  const owner = await getUser(params.ownerUserId)
  const fromE164 = await resolveBusinessLine({
    ownerUserId: params.ownerUserId,
    businessLine: params.businessLine,
    callLogId: params.callLogId,
  })
  const text = buildIntakeBookingCustomerSmsText({
    customerName: params.customerName,
    businessName: owner?.business_name?.trim() || owner?.name?.trim() || SITE_NAME,
    scheduledAtIso: params.scheduledAtIso,
    availabilityLabel: params.availabilityLabel,
    isAsap: params.isAsap,
    serviceAddress: params.serviceAddress,
    jobType: params.jobType,
  })

  const orgId =
    params.organizationId && !params.organizationId.startsWith("legacy-")
      ? params.organizationId
      : null

  // Log into sms_messages so the confirmation appears in Messages inbox.
  const sent = await sendAndLogWorkspaceCustomerSms({
    ownerUserId: params.ownerUserId,
    toE164,
    text,
    organizationId: orgId,
    fromE164: fromE164 || null,
  })

  if (!sent.ok) {
    return { sent: false, error: sent.error }
  }
  return { sent: true, error: sent.delivery_warning ?? null }
}
