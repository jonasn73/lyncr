// Service address required for Telnyx LNP port orders — scoped to the active workspace.

import {
  getDefaultOrganizationForOwner,
  getMessaging10DlcRegistration,
  getOrganizationForOwner,
  getSmsRegistrationForOrganization,
} from "@/lib/db"

type PortServiceAddress = {
  street: string
  city: string
  state: string
  postal_code: string
}

export type PortAddressValidation = {
  ok: boolean
  organization_id: string | null
  missing_fields: string[]
  address: PortServiceAddress | null
  source: "sms_registration" | "messaging_10dlc" | null
}

const FIELD_LABELS: Record<keyof PortServiceAddress, string> = {
  street: "street",
  city: "city",
  state: "state",
  postal_code: "zip",
}

function missingFromAddress(addr: Partial<PortServiceAddress>): string[] {
  const missing: string[] = []
  if (!addr.street?.trim()) missing.push(FIELD_LABELS.street)
  if (!addr.city?.trim()) missing.push(FIELD_LABELS.city)
  if (!addr.state?.trim()) missing.push(FIELD_LABELS.state)
  if (!addr.postal_code?.trim()) missing.push(FIELD_LABELS.postal_code)
  return missing
}

export async function resolvePortOrganizationId(
  ownerUserId: string,
  rawOrganizationId?: string | null
): Promise<{ organization_id: string | null; org_uuid: string | null }> {
  let organizationId = String(rawOrganizationId ?? "").trim()
  if (!organizationId) {
    const def = await getDefaultOrganizationForOwner(ownerUserId)
    organizationId = def?.id ?? ""
  }
  if (!organizationId || organizationId.startsWith("legacy-")) {
    return { organization_id: organizationId || null, org_uuid: null }
  }
  const org = await getOrganizationForOwner(organizationId, ownerUserId)
  if (!org || org.id.startsWith("legacy-")) {
    return { organization_id: organizationId, org_uuid: null }
  }
  return { organization_id: org.id, org_uuid: org.id }
}

/** Load street/city/state/ZIP for the current workspace (sms_registrations, then org 10DLC row). */
export async function validatePortServiceAddress(
  ownerUserId: string,
  organizationId?: string | null
): Promise<PortAddressValidation> {
  const { organization_id, org_uuid } = await resolvePortOrganizationId(ownerUserId, organizationId)

  if (!org_uuid) {
    return {
      ok: false,
      organization_id,
      missing_fields: ["street", "city", "state", "zip"],
      address: null,
      source: null,
    }
  }

  const smsReg = await getSmsRegistrationForOrganization(ownerUserId, org_uuid)
  if (smsReg?.street?.trim() && smsReg.city?.trim() && smsReg.state?.trim() && smsReg.postal_code?.trim()) {
    const address: PortServiceAddress = {
      street: smsReg.street.trim(),
      city: smsReg.city.trim(),
      state: smsReg.state.trim().toUpperCase().slice(0, 2),
      postal_code: smsReg.postal_code.trim(),
    }
    return {
      ok: true,
      organization_id: org_uuid,
      missing_fields: [],
      address,
      source: "sms_registration",
    }
  }

  const tenDlc = await getMessaging10DlcRegistration(ownerUserId, org_uuid)
  const candidate: Partial<PortServiceAddress> = {
    street: smsReg?.street?.trim() || tenDlc?.street?.trim() || "",
    city: smsReg?.city?.trim() || tenDlc?.city?.trim() || "",
    state: smsReg?.state?.trim() || tenDlc?.state?.trim() || "",
    postal_code: smsReg?.postal_code?.trim() || tenDlc?.postal_code?.trim() || "",
  }
  const missing = missingFromAddress(candidate)
  if (missing.length === 0) {
    return {
      ok: true,
      organization_id: org_uuid,
      missing_fields: [],
      address: {
        street: candidate.street!.trim(),
        city: candidate.city!.trim(),
        state: candidate.state!.trim().toUpperCase().slice(0, 2),
        postal_code: candidate.postal_code!.trim(),
      },
      source: tenDlc?.street ? "messaging_10dlc" : "sms_registration",
    }
  }

  return {
    ok: false,
    organization_id: org_uuid,
    missing_fields: missing,
    address: null,
    source: null,
  }
}

export const PORT_ADDRESS_ERROR_MESSAGE =
  "Complete your business address for this workspace before porting. Carriers require a service address that matches your bill."

export const PORT_ADDRESS_ERROR_CODE = "missing_service_address"
