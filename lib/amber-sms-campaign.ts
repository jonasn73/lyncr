/**
 * Attach Amber control DID to the shop’s approved 10DLC campaign (in-app).
 * Prefer the workspace campaign over the platform shared campaign.
 */

import { getMessaging10DlcRegistration, normalizePhoneNumberE164 } from "@/lib/db"
import { assignNumberToTelnyx10DlcCampaign } from "@/lib/telnyx-10dlc"
import { getTelnyxApiKey } from "@/lib/telnyx-config"
import {
  configureNumberMessaging,
  getTelnyx10DlcAssignmentStatus,
} from "@/lib/telnyx-messaging-config"
import { getPlatform10DlcCampaignId } from "@/lib/telnyx-shared-campaign"

const TELNYX_BASE = "https://api.telnyx.com/v2"

export type AmberSmsCampaignState =
  | "ready"
  | "pending"
  | "not_assigned"
  | "no_campaign"
  | "failed"
  | "unknown"

export type AmberSmsCampaignView = {
  state: AmberSmsCampaignState
  campaign_id: string | null
  /** True when the shop has an approved Lyncr campaign we can attach to. */
  workspace_campaign_ready: boolean
  label: string
  detail: string | null
}

type CampaignTarget = {
  campaignId: string
  source: "workspace" | "platform"
}

/** Resolve which campaign Amber should join — workspace first, then platform env. */
export async function resolveAmberCampaignTarget(params: {
  userId: string
  organizationId?: string | null
}): Promise<
  | { ok: true; target: CampaignTarget }
  | { ok: false; reason: "no_campaign"; detail: string }
> {
  const reg = await getMessaging10DlcRegistration(params.userId, params.organizationId)
  const workspaceCampaign = reg?.campaign_id?.trim() || null
  const status = String(reg?.status || "").toLowerCase()
  if (workspaceCampaign && status === "approved") {
    return { ok: true, target: { campaignId: workspaceCampaign, source: "workspace" } }
  }

  const platform = getPlatform10DlcCampaignId()
  if (platform) {
    return { ok: true, target: { campaignId: platform, source: "platform" } }
  }

  return {
    ok: false,
    reason: "no_campaign",
    detail:
      "Finish SMS registration in Settings so Lyncr can activate Amber texts automatically. You do not need to leave Lyncr.",
  }
}

async function readAssignmentStatusRaw(e164: string): Promise<{
  campaignId: string | null
  assignmentStatus: string | null
}> {
  const target = normalizePhoneNumberE164(e164.trim())
  try {
    getTelnyxApiKey()
  } catch {
    return { campaignId: null, assignmentStatus: null }
  }
  const res = await fetch(
    `${TELNYX_BASE}/10dlc/phoneNumberCampaign?phoneNumber=${encodeURIComponent(target)}`,
    {
      headers: {
        Authorization: `Bearer ${getTelnyxApiKey()}`,
        "Content-Type": "application/json",
      },
    }
  )
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { campaignId: null, assignmentStatus: null }

  const root = body as {
    data?: Record<string, unknown> | Record<string, unknown>[]
    records?: Record<string, unknown>[]
  }
  const record: Record<string, unknown> | null = Array.isArray(root.records)
    ? (root.records[0] ?? null)
    : Array.isArray(root.data)
      ? (root.data[0] ?? null)
      : root.data && typeof root.data === "object"
        ? root.data
        : null
  if (!record) return { campaignId: null, assignmentStatus: null }

  const campaignId =
    (record.campaignId as string | undefined) ||
    (record.campaign_id as string | undefined) ||
    (record.telnyxCampaignId as string | undefined) ||
    null
  const assignmentStatus = String(
    record.assignmentStatus ?? record.assignment_status ?? ""
  )
    .trim()
    .toUpperCase()

  return {
    campaignId: campaignId ? String(campaignId) : null,
    assignmentStatus: assignmentStatus || null,
  }
}

/** Live SMS readiness for the Amber DID (shown in Settings). */
export async function getAmberSmsCampaignView(params: {
  userId: string
  organizationId?: string | null
  amberNumber: string | null
}): Promise<AmberSmsCampaignView> {
  const target = await resolveAmberCampaignTarget({
    userId: params.userId,
    organizationId: params.organizationId,
  })
  const workspaceReady = target.ok && target.target.source === "workspace"

  if (!params.amberNumber) {
    return {
      state: target.ok ? "not_assigned" : "no_campaign",
      campaign_id: target.ok ? target.target.campaignId : null,
      workspace_campaign_ready: workspaceReady,
      label: target.ok ? "Pick a number to activate" : "SMS registration needed",
      detail: target.ok ? null : target.detail,
    }
  }

  const raw = await readAssignmentStatusRaw(params.amberNumber)
  if (raw.campaignId) {
    if (raw.assignmentStatus && /FAIL|REJECT|ERROR|DENIED/.test(raw.assignmentStatus)) {
      return {
        state: "failed",
        campaign_id: raw.campaignId,
        workspace_campaign_ready: workspaceReady,
        label: "SMS activation failed",
        detail: `Carrier returned ${raw.assignmentStatus}. Tap Retry — stay in Lyncr.`,
      }
    }
    if (raw.assignmentStatus && /PEND/.test(raw.assignmentStatus)) {
      return {
        state: "pending",
        campaign_id: raw.campaignId,
        workspace_campaign_ready: workspaceReady,
        label: "SMS activating…",
        detail:
          "Your Amber number is on your Lyncr campaign. Carriers can take a little while — verify codes still use your business line until this shows Ready.",
      }
    }
    // Assigned with no pending flag — treat as ready (Telnyx may omit status when complete).
    const legacy = await getTelnyx10DlcAssignmentStatus(params.amberNumber)
    if (legacy.assigned) {
      return {
        state: "ready",
        campaign_id: raw.campaignId,
        workspace_campaign_ready: workspaceReady,
        label: "SMS ready",
        detail: "Amber can send texts on your shop campaign.",
      }
    }
  }

  if (!target.ok) {
    return {
      state: "no_campaign",
      campaign_id: null,
      workspace_campaign_ready: false,
      label: "SMS registration needed",
      detail: target.detail,
    }
  }

  return {
    state: "not_assigned",
    campaign_id: target.target.campaignId,
    workspace_campaign_ready: workspaceReady,
    label: "SMS not activated yet",
    detail: "Tap Retry to attach Amber to your Lyncr campaign. You do not need to leave the app.",
  }
}

/**
 * Messaging profile + assign Amber to the shop (or platform) campaign.
 * Safe to call repeatedly (idempotent when already assigned/pending).
 */
export async function ensureAmberOnWorkspaceCampaign(params: {
  userId: string
  organizationId?: string | null
  amberNumber: string
}): Promise<AmberSmsCampaignView> {
  const e164 = normalizePhoneNumberE164(params.amberNumber)
  try {
    await configureNumberMessaging(e164)
  } catch (e) {
    console.warn("[amber-sms-campaign] messaging profile:", e)
  }

  const target = await resolveAmberCampaignTarget({
    userId: params.userId,
    organizationId: params.organizationId,
  })
  if (!target.ok) {
    return getAmberSmsCampaignView({
      userId: params.userId,
      organizationId: params.organizationId,
      amberNumber: e164,
    })
  }

  const current = await readAssignmentStatusRaw(e164)
  const alreadyOnTarget =
    current.campaignId &&
    current.campaignId === target.target.campaignId &&
    !(current.assignmentStatus && /FAIL|REJECT|ERROR|DENIED/.test(current.assignmentStatus))

  if (!alreadyOnTarget) {
    const assign = await assignNumberToTelnyx10DlcCampaign(e164, target.target.campaignId)
    if (!assign.ok) {
      console.warn("[amber-sms-campaign] assign failed:", assign.error)
      // Still return live view — may already be pending elsewhere.
    }
  }

  return getAmberSmsCampaignView({
    userId: params.userId,
    organizationId: params.organizationId,
    amberNumber: e164,
  })
}
