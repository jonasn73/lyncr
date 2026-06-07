// Save service address only (for LNP porting) — not full 10DLC carrier submission.

import {
  getMessaging10DlcRegistration,
  getOrganizationForOwner,
  getSmsRegistrationForOrganization,
  getUser,
  upsertMessaging10DlcRegistration,
  upsertSmsRegistration,
} from "@/lib/db"
import { resolvePortOrganizationId } from "@/lib/port-address-validation"
import type { SmsRegistration } from "@/lib/types"

const DEFAULT_USE_CASE =
  "Sending automated service notifications and technician dispatch links to customers who opt in via our platform."

export type PortServiceAddressInput = {
  organization_id?: string | null
  legal_business_name?: string
  street: string
  city: string
  state: string
  postal_code: string
}

export function validatePortServiceAddressInput(input: PortServiceAddressInput): string | null {
  if (!input.street.trim()) return "Street address is required."
  if (!input.city.trim()) return "City is required."
  if (!input.state.trim()) return "State is required."
  if (!input.postal_code.trim()) return "ZIP code is required."
  return null
}

/** Persist address for this workspace only — keeps DRAFT status (no carrier review lock). */
export async function savePortServiceAddressForOwner(
  ownerUserId: string,
  input: PortServiceAddressInput
): Promise<{ registration: SmsRegistration }> {
  const validationError = validatePortServiceAddressInput(input)
  if (validationError) throw new Error(validationError)

  const owner = await getUser(ownerUserId)
  if (!owner) throw new Error("User not found")

  const { org_uuid: orgUuid } = await resolvePortOrganizationId(ownerUserId, input.organization_id)
  if (!orgUuid) {
    throw new Error("Select a business workspace before saving your service address.")
  }

  const org = await getOrganizationForOwner(orgUuid, ownerUserId)
  const existing = await getSmsRegistrationForOrganization(ownerUserId, orgUuid)

  const keepStatus =
    existing?.status === "PENDING_APPROVAL" || existing?.status === "APPROVED"
      ? existing.status
      : "DRAFT"

  const registration = await upsertSmsRegistration({
    owner_user_id: ownerUserId,
    organization_id: orgUuid,
    legal_business_name:
      input.legal_business_name?.trim() ||
      existing?.legal_business_name ||
      org?.name ||
      owner.business_name?.trim() ||
      owner.name,
    entity_type: existing?.entity_type || "Sole Proprietorship",
    tax_id_ein: existing?.tax_id_ein ?? null,
    street: input.street.trim(),
    city: input.city.trim(),
    state: input.state.trim().toUpperCase().slice(0, 2),
    postal_code: input.postal_code.trim(),
    use_case_description: existing?.use_case_description || DEFAULT_USE_CASE,
    status: keepStatus,
  })

  const tenDlc = await getMessaging10DlcRegistration(ownerUserId, orgUuid)
  await upsertMessaging10DlcRegistration(
    ownerUserId,
    {
      street: input.street.trim(),
      city: input.city.trim(),
      state: input.state.trim().toUpperCase().slice(0, 2),
      postal_code: input.postal_code.trim(),
      country: "US",
      status: tenDlc?.status ?? "draft",
    },
    orgUuid
  )

  return { registration }
}

/** Load saved address fields for the port modal (prefill). */
export async function getPortServiceAddressForOwner(
  ownerUserId: string,
  organizationId?: string | null
): Promise<{
  organization_id: string | null
  legal_business_name: string
  street: string
  city: string
  state: string
  postal_code: string
}> {
  const { org_uuid } = await resolvePortOrganizationId(ownerUserId, organizationId)
  if (!org_uuid) {
    return {
      organization_id: null,
      legal_business_name: "",
      street: "",
      city: "",
      state: "",
      postal_code: "",
    }
  }

  const org = await getOrganizationForOwner(org_uuid, ownerUserId)
  const owner = await getUser(ownerUserId)
  const smsReg = await getSmsRegistrationForOrganization(ownerUserId, org_uuid)
  const tenDlc = await getMessaging10DlcRegistration(ownerUserId, org_uuid)

  return {
    organization_id: org_uuid,
    legal_business_name:
      smsReg?.legal_business_name ||
      org?.name ||
      owner?.business_name?.trim() ||
      owner?.name ||
      "",
    street: smsReg?.street || tenDlc?.street || "",
    city: smsReg?.city || tenDlc?.city || "",
    state: smsReg?.state || tenDlc?.state || "",
    postal_code: smsReg?.postal_code || tenDlc?.postal_code || "",
  }
}
