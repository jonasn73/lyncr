// Server-only: build structured carrier submission summary for the 10DLC status modal.

import { resolvePrimaryBusinessLineForOrganization } from "@/lib/primary-business-line"
import { formatTelnyxRegistryText } from "@/lib/telnyx-10dlc"
import type {
  SmsRegistrationLifecycleStage,
  SmsRegistrationSubmissionSummary,
} from "@/lib/sms-registration-submission-summary-types"
import type { Workspace10DlcCompliance } from "@/lib/workspace-10dlc-compliance"

export type {
  SmsRegistrationLifecycleStage,
  SmsRegistrationSubmissionSummary,
} from "@/lib/sms-registration-submission-summary-types"

const TELNYX_PENDING = new Set(["paid", "submitted", "pending_review"])
const TELNYX_REJECTED = new Set(["rejected", "failed"])

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

  const phone = await resolvePrimaryBusinessLineForOrganization(
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
      ? formatTelnyxRegistryText(telnyx?.status_detail) ||
        (reg?.status === "REJECTED"
          ? "Carrier rejected this registration. Update your details and resubmit."
          : null)
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
    status_detail: formatTelnyxRegistryText(telnyx?.status_detail),
    lifecycle_stage: lifecycleStage,
    rejection_reason: rejectionReason,
  }
}
