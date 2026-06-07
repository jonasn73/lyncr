// Build a structured carrier submission summary for the dashboard 10DLC status modal.

import { getPhoneNumbers, listPortingOrdersForOwner } from "@/lib/db"
import type { Workspace10DlcCompliance } from "@/lib/workspace-10dlc-compliance"

const TELNYX_PENDING = new Set(["paid", "submitted", "pending_review"])
const TELNYX_REJECTED = new Set(["rejected", "failed"])

export type SmsRegistrationLifecycleStage = "submitted" | "carrier_review" | "approved" | "rejected"

export type SmsRegistrationSubmissionSummary = {
  legal_business_name: string | null
  entity_type: string | null
  business_address: string | null
  use_case_description: string | null
  target_phone_line: string | null
  target_line_label: string | null
  submission_date: string | null
  carrier_reference_id: string | null
  carrier_reference_kind: "campaign" | "brand" | null
  registration_status: string | null
  organization_status: string | null
  telnyx_status: string | null
  status_detail: string | null
  lifecycle_stage: SmsRegistrationLifecycleStage
  rejection_reason: string | null
}

function formatAddress(parts: {
  street?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
}): string | null {
  const street = parts.street?.trim()
  const city = parts.city?.trim()
  const state = parts.state?.trim()
  const zip = parts.postal_code?.trim()
  if (!street || !city || !state || !zip) return null
  return `${street}, ${city}, ${state} ${zip}`
}

function resolveLifecycleStage(
  compliance: Workspace10DlcCompliance,
  telnyxStatus: string | null
): SmsRegistrationLifecycleStage {
  const regStatus = compliance.registration?.status ?? null
  const orgStatus = compliance.organization_status

  if (
    regStatus === "REJECTED" ||
    orgStatus === "REJECTED" ||
    TELNYX_REJECTED.has(telnyxStatus ?? "")
  ) {
    return "rejected"
  }

  if (compliance.sms_ready || regStatus === "APPROVED" || orgStatus === "APPROVED" || telnyxStatus === "approved") {
    return "approved"
  }

  if (
    compliance.pending_approval ||
    regStatus === "PENDING_APPROVAL" ||
    orgStatus === "PENDING_APPROVAL" ||
    TELNYX_PENDING.has(telnyxStatus ?? "")
  ) {
    return "carrier_review"
  }

  return "submitted"
}

async function resolveTargetPhoneLine(
  ownerUserId: string,
  organizationId: string | null,
  assignedNumber: string | null | undefined
): Promise<{ number: string | null; label: string | null }> {
  if (assignedNumber?.trim()) {
    return { number: assignedNumber.trim(), label: null }
  }

  if (organizationId) {
    const [numbers, portOrders] = await Promise.all([
      getPhoneNumbers(ownerUserId, organizationId),
      listPortingOrdersForOwner(ownerUserId, organizationId),
    ])

    const active = numbers.find((n) => n.status === "active")
    if (active) {
      return {
        number: active.number,
        label: active.label?.trim() || active.friendly_name?.trim() || null,
      }
    }

    const porting = numbers.find((n) => n.status === "porting")
    if (porting) {
      return {
        number: porting.number,
        label: porting.label?.trim() || porting.friendly_name?.trim() || "Port in progress",
      }
    }

    const openPort = portOrders.find((o) => o.status === "pending" || o.status === "processing")
    if (openPort) {
      return { number: openPort.phone_number, label: "Number transfer in progress" }
    }

    if (numbers[0]) {
      return {
        number: numbers[0].number,
        label: numbers[0].label?.trim() || numbers[0].friendly_name?.trim() || null,
      }
    }
  }

  return { number: null, label: null }
}

/** Load submission summary for pending / review / rejected / approved states. */
export async function buildSmsRegistrationSubmissionSummary(
  ownerUserId: string,
  compliance: Workspace10DlcCompliance
): Promise<SmsRegistrationSubmissionSummary | null> {
  const reg = compliance.registration
  const telnyx = compliance.telnyx_registration
  const telnyxStatus = telnyx?.status ?? null

  if (!reg && !telnyx) return null

  const lifecycleStage = resolveLifecycleStage(compliance, telnyxStatus)
  if (lifecycleStage === "submitted" && reg?.status === "DRAFT" && !telnyx?.brand_id && !telnyx?.campaign_id) {
    return null
  }

  const phone = await resolveTargetPhoneLine(
    ownerUserId,
    compliance.organization_id,
    telnyx?.assigned_number
  )

  const campaignId = telnyx?.campaign_id?.trim() || null
  const brandId = telnyx?.brand_id?.trim() || null
  const carrierReferenceId = campaignId || brandId
  const carrierReferenceKind: "campaign" | "brand" | null = campaignId ? "campaign" : brandId ? "brand" : null

  const businessAddress =
    formatAddress({
      street: reg?.street ?? telnyx?.street,
      city: reg?.city ?? telnyx?.city,
      state: reg?.state ?? telnyx?.state,
      postal_code: reg?.postal_code ?? telnyx?.postal_code,
    }) ?? null

  const rejectionReason =
    lifecycleStage === "rejected"
      ? telnyx?.status_detail?.trim() ||
        (reg?.status === "REJECTED" ? "Carrier rejected this registration. Update your details and resubmit." : null)
      : null

  const submissionDate =
    reg?.status === "PENDING_APPROVAL" || reg?.status === "APPROVED" || reg?.status === "REJECTED"
      ? reg.updated_at || reg.created_at
      : telnyx?.updated_at || telnyx?.created_at || reg?.updated_at || reg?.created_at || null

  return {
    legal_business_name: reg?.legal_business_name?.trim() || telnyx?.legal_company_name?.trim() || null,
    entity_type: reg?.entity_type?.trim() || telnyx?.entity_type || null,
    business_address: businessAddress,
    use_case_description: reg?.use_case_description?.trim() || telnyx?.campaign_description?.trim() || null,
    target_phone_line: phone.number,
    target_line_label: phone.label,
    submission_date: submissionDate,
    carrier_reference_id: carrierReferenceId,
    carrier_reference_kind: carrierReferenceKind,
    registration_status: reg?.status ?? null,
    organization_status: compliance.organization_status,
    telnyx_status: telnyxStatus,
    status_detail: telnyx?.status_detail?.trim() || null,
    lifecycle_stage: lifecycleStage,
    rejection_reason: rejectionReason,
  }
}

export function formatSmsSubmissionDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
