// Submit SMS carrier compliance from the dashboard registration form (server-only).

import {
  getDefaultOrganizationForOwner,
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
import type { SmsRegistration, SmsRegistrationOrgStatus } from "@/lib/types"

export type { SmsRegistrationFormInput } from "@/lib/sms-registration-constants"

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
  await upsertMessaging10DlcRegistration(ownerUserId, {
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
    use_case: tenDlcEntity === "SOLE_PROPRIETOR" ? "SOLE_PROPRIETOR" : "LOW_VOLUME",
    campaign_description: input.use_case_description.trim(),
    status: "pending_review",
    status_detail: "Submitted from dashboard SMS registration form — awaiting carrier review.",
  })

  return { registration, org_status: "PENDING_APPROVAL" }
}
