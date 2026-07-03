// Resolve per-workspace SMS / 10DLC carrier compliance for banners and settings.

import {
  getMessaging10DlcRegistration,
  getOrganizationSmsRegistrationStatus,
  getSmsRegistrationForOwner,
  getPhoneNumbers,
} from "@/lib/db"
import { getPlatform10DlcCampaignId, isUsLocalDid } from "@/lib/telnyx-shared-campaign"
import { isTelnyxRegistryRejected, normalizeTelnyxRegistryStatus } from "@/lib/telnyx-10dlc"
import type { Messaging10DlcRegistration, SmsRegistration, SmsRegistrationOrgStatus } from "@/lib/types"

const TELNYX_PENDING_STATUSES = new Set(["paid", "submitted", "pending_review"])

function telnyxDetailLooksLikeFailure(detail: string | null | undefined): boolean {
  const blob = (detail ?? "").toLowerCase()
  return (
    blob.includes("campaign creation failed") ||
    blob.includes("campaign registration failed") ||
    blob.includes("brand verification failed") ||
    blob.includes("brand registration failed")
  )
}

function telnyxRegistryIsRejected(telnyx: Messaging10DlcRegistration | null): boolean {
  if (!telnyx) return false
  const status = (telnyx.status ?? "").trim().toLowerCase()
  if (status === "failed" || status === "rejected") return true
  if (isTelnyxRegistryRejected(telnyx.status ?? "")) return true
  if (normalizeTelnyxRegistryStatus(telnyx.status ?? "") === "rejected") return true
  return telnyxDetailLooksLikeFailure(telnyx.status_detail)
}

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

  let sharedCampaignReady = false
  const platformCampaignId = getPlatform10DlcCampaignId()
  if (platformCampaignId && orgUuid) {
    const lines = await getPhoneNumbers(ownerUserId, orgUuid)
    sharedCampaignReady = lines.some(
      (line) =>
        line.status === "active" &&
        line.type === "local" &&
        isUsLocalDid(line.number)
    )
  }

  const sms_ready = dashboardApproved || telnyxReady || sharedCampaignReady

  const telnyxStatus = (telnyx?.status ?? "").trim().toLowerCase()
  const telnyxFailed = telnyxRegistryIsRejected(telnyx)
  const dashboardRejected =
    registration?.status === "REJECTED" || organization_status === "REJECTED"

  const pending_approval =
    !sms_ready &&
    !telnyxFailed &&
    !dashboardRejected &&
    (registration?.status === "PENDING_APPROVAL" ||
      organization_status === "PENDING_APPROVAL" ||
      TELNYX_PENDING_STATUSES.has(telnyxStatus))

  return {
    organization_id: orgUuid,
    registration,
    organization_status,
    telnyx_registration: telnyx,
    sms_ready,
    pending_approval,
  }
}
