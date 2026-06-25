// Submit SMS carrier compliance from the dashboard registration form (server-only).

import {
  getDefaultOrganizationForOwner,
  getMessaging10DlcRegistration,
  getOrganizationForOwner,
  getUser,
  setOrganizationSmsRegistrationStatus,
  upsertMessaging10DlcRegistration,
  upsertSmsRegistration,
} from "@/lib/db"
import {
  mapEntityTypeToTenDlc,
  requiresSmsRegistrationEin,
  validateSmsRegistrationInput,
  type SmsRegistrationFormInput,
} from "@/lib/sms-registration-constants"
import { defaultCampaignCopy, submitMessaging10DlcToTelnyx } from "@/lib/messaging-10dlc"
import { isTelnyxBrandNotReadyForCampaignError } from "@/lib/telnyx-10dlc"
import type { SmsRegistration, SmsRegistrationOrgStatus } from "@/lib/types"

export type { SmsRegistrationFormInput } from "@/lib/sms-registration-constants"

/** Drop stale Telnyx brand/campaign ids after a failed attempt so resubmit creates fresh records. */
async function prepare10DlcResubmit(ownerUserId: string, orgUuid: string): Promise<void> {
  const telnyx = await getMessaging10DlcRegistration(ownerUserId, orgUuid)
  if (!telnyx) return

  if (
    telnyx.status === "failed" &&
    telnyx.status_detail &&
    isTelnyxBrandNotReadyForCampaignError(telnyx.status_detail) &&
    telnyx.brand_id
  ) {
    await upsertMessaging10DlcRegistration(
      ownerUserId,
      {
        status: "pending_review",
        status_detail:
          "Brand submitted to US carriers. Campaign registration will complete automatically once your brand is verified (usually 1–3 business days).",
      },
      orgUuid
    )
    return
  }

  const stale = telnyx.status === "failed" || telnyx.status === "rejected"
  if (!stale) return
  await upsertMessaging10DlcRegistration(
    ownerUserId,
    {
      brand_id: null,
      campaign_id: null,
      status: "paid",
      status_detail: "Preparing a fresh carrier submission with your updated business details…",
    },
    orgUuid
  )
}

/** Persist compliance metadata and mark the workspace pending carrier review. */
export async function submitSmsRegistrationForOwner(
  ownerUserId: string,
  input: SmsRegistrationFormInput
): Promise<{ registration: SmsRegistration; org_status: SmsRegistrationOrgStatus }> {
  const validationError = validateSmsRegistrationInput(input)
  if (validationError) throw new Error(validationError)

  const owner = await getUser(ownerUserId)
  if (!owner) throw new Error("User not found")

  let organizationId = String(input.organization_id ?? "").trim()
  if (!organizationId) {
    const def = await getDefaultOrganizationForOwner(ownerUserId)
    organizationId = def?.id ?? ""
  }
  const org = organizationId ? await getOrganizationForOwner(organizationId, ownerUserId) : null
  const orgUuid = org?.id?.startsWith("legacy-") ? null : org?.id ?? null
  if (!orgUuid) {
    throw new Error(
      "Select a business workspace before submitting SMS registration. If workspaces are missing, run migration 065 in Neon."
    )
  }

  const registration = await upsertSmsRegistration({
    owner_user_id: ownerUserId,
    organization_id: orgUuid,
    legal_business_name: input.legal_business_name.trim(),
    entity_type: input.entity_type.trim(),
    tax_id_ein: (input.tax_id_ein ?? "").replace(/\D/g, "") || null,
    street: input.street.trim(),
    city: input.city.trim(),
    state: input.state.trim().toUpperCase().slice(0, 2),
    postal_code: input.postal_code.trim(),
    use_case_description: input.use_case_description.trim(),
    status: "PENDING_APPROVAL",
  })

  if (orgUuid) {
    await setOrganizationSmsRegistrationStatus(orgUuid, ownerUserId, "PENDING_APPROVAL")
  }

  const tenDlcEntity = mapEntityTypeToTenDlc(input.entity_type)
  const displayName = input.legal_business_name.trim()
  const copy = defaultCampaignCopy(displayName)
  const useCase = tenDlcEntity === "SOLE_PROPRIETOR" ? "SOLE_PROPRIETOR" : "LOW_VOLUME"

  await prepare10DlcResubmit(ownerUserId, orgUuid)

  await upsertMessaging10DlcRegistration(
    ownerUserId,
    {
      entity_type: tenDlcEntity,
      legal_company_name: displayName,
      display_name: displayName,
      ein: requiresSmsRegistrationEin(input.entity_type) ? (input.tax_id_ein ?? "").replace(/\D/g, "") : null,
      vertical: "PROFESSIONAL",
      email: owner.email,
      phone: owner.phone,
      street: input.street.trim(),
      city: input.city.trim(),
      state: input.state.trim().toUpperCase().slice(0, 2),
      postal_code: input.postal_code.trim(),
      country: "US",
      use_case: useCase,
      campaign_description: input.use_case_description.trim() || copy.description,
      sample_message_1: copy.sample1,
      sample_message_2: copy.sample2,
      message_flow: copy.messageFlow,
      fee_paid: true,
      status: "pending_review",
      status_detail: "Submitting your registration to US carriers…",
    },
    orgUuid
  )

  const carrier = await submitMessaging10DlcToTelnyx(ownerUserId, orgUuid)
  if (!carrier.ok) {
    await upsertSmsRegistration({
      owner_user_id: ownerUserId,
      organization_id: orgUuid,
      legal_business_name: input.legal_business_name.trim(),
      entity_type: input.entity_type.trim(),
      tax_id_ein: (input.tax_id_ein ?? "").replace(/\D/g, "") || null,
      street: input.street.trim(),
      city: input.city.trim(),
      state: input.state.trim().toUpperCase().slice(0, 2),
      postal_code: input.postal_code.trim(),
      use_case_description: input.use_case_description.trim(),
      status: "REJECTED",
    })
    await setOrganizationSmsRegistrationStatus(orgUuid, ownerUserId, "REJECTED")
    throw new Error(carrier.error)
  }
  if (carrier.registration.status === "failed") {
    await upsertSmsRegistration({
      owner_user_id: ownerUserId,
      organization_id: orgUuid,
      legal_business_name: input.legal_business_name.trim(),
      entity_type: input.entity_type.trim(),
      tax_id_ein: (input.tax_id_ein ?? "").replace(/\D/g, "") || null,
      street: input.street.trim(),
      city: input.city.trim(),
      state: input.state.trim().toUpperCase().slice(0, 2),
      postal_code: input.postal_code.trim(),
      use_case_description: input.use_case_description.trim(),
      status: "REJECTED",
    })
    await setOrganizationSmsRegistrationStatus(orgUuid, ownerUserId, "REJECTED")
    throw new Error(carrier.registration.status_detail || "Carrier rejected the SMS registration.")
  }

  return { registration, org_status: "PENDING_APPROVAL" }
}
