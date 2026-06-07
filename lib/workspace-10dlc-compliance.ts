// Resolve per-workspace SMS / 10DLC carrier compliance for banners and settings.

import {
  getMessaging10DlcRegistration,
  getOrganizationSmsRegistrationStatus,
  getSmsRegistrationForOwner,
} from "@/lib/db"
import type { Messaging10DlcRegistration, SmsRegistration, SmsRegistrationOrgStatus } from "@/lib/types"

const TELNYX_PENDING_STATUSES = new Set(["paid", "submitted", "pending_review"])

export type Workspace10DlcCompliance = {
  organization_id: string | null
  registration: SmsRegistration | null
  organization_status: SmsRegistrationOrgStatus
  telnyx_registration: Messaging10DlcRegistration | null
  sms_ready: boolean
  pending_approval: boolean
}

/** Load carrier compliance state for one business workspace (not owner-global). */
export async function getWorkspace10DlcCompliance(
  ownerUserId: string,
  organizationId: string | null
): Promise<Workspace10DlcCompliance> {
  const orgUuid =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : null

  const [registration, orgStatusRaw, telnyx] = await Promise.all([
    orgUuid ? getSmsRegistrationForOwner(ownerUserId, orgUuid) : Promise.resolve(null),
    orgUuid ? getOrganizationSmsRegistrationStatus(orgUuid, ownerUserId) : Promise.resolve(null),
    orgUuid
      ? getMessaging10DlcRegistration(ownerUserId, orgUuid)
      : getMessaging10DlcRegistration(ownerUserId),
  ])

  const organization_status: SmsRegistrationOrgStatus =
    orgStatusRaw ??
    (registration?.status === "PENDING_APPROVAL"
      ? "PENDING_APPROVAL"
      : registration?.status === "APPROVED"
        ? "APPROVED"
        : registration?.status === "REJECTED"
          ? "REJECTED"
          : "NONE")

  const dashboardApproved =
    registration?.status === "APPROVED" || organization_status === "APPROVED"
  const telnyxReady =
    telnyx?.status === "approved" && Boolean(telnyx.assigned_number?.trim())
  const sms_ready = dashboardApproved || telnyxReady

  const pending_approval =
    !sms_ready &&
    (registration?.status === "PENDING_APPROVAL" ||
      organization_status === "PENDING_APPROVAL" ||
      TELNYX_PENDING_STATUSES.has(telnyx?.status ?? ""))

  return {
    organization_id: orgUuid,
    registration,
    organization_status,
    telnyx_registration: telnyx,
    sms_ready,
    pending_approval,
  }
}
