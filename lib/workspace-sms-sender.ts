// Resolve which business line should send outbound SMS for one workspace.

import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  resolveActiveLineFor10DlcAssignment,
  resolvePrimaryBusinessLineForOrganization,
} from "@/lib/primary-business-line"
import { isTelnyxOwnedNumber } from "@/lib/telnyx-messaging-config"
import { resolveTelnyxMessagingFromE164 } from "@/lib/telnyx-sms"

export type WorkspaceSmsSenderBlockReason = "porting" | "no_line" | "invalid_line"

export type WorkspaceSmsSenderResult =
  | { ok: true; from_e164: string; label: string | null }
  | {
      ok: false
      reason: WorkspaceSmsSenderBlockReason
      message: string
      intended_number: string | null
      label: string | null
    }

function normalizeOrgId(organizationId?: string | null): string | null {
  const trimmed = organizationId?.trim()
  if (!trimmed || trimmed.startsWith("legacy-")) return null
  return trimmed
}

/**
 * Pick the outbound SMS "from" line for a workspace.
 * Uses only carrier-live active DIDs for that business — never another workspace's line.
 */
export async function resolveWorkspaceSmsSender(
  ownerUserId: string,
  organizationId?: string | null
): Promise<WorkspaceSmsSenderResult> {
  const orgId = normalizeOrgId(organizationId)

  if (!orgId) {
    const fallback = await resolveTelnyxMessagingFromE164(ownerUserId)
    if (!fallback) {
      return {
        ok: false,
        reason: "no_line",
        message:
          "This account has no active business line for SMS yet. Add a line under Settings → Lines, or share the setup link manually.",
        intended_number: null,
        label: null,
      }
    }
    const owned = await isTelnyxOwnedNumber(fallback)
    if (!owned) {
      return {
        ok: false,
        reason: "invalid_line",
        message: `SMS cannot send from ${formatPhoneDisplay(fallback)} — that number is not on your Telnyx messaging account. Assign a valid business line under Settings → Lines.`,
        intended_number: fallback,
        label: null,
      }
    }
    return { ok: true, from_e164: fallback, label: null }
  }

  const [activeFrom, primary] = await Promise.all([
    resolveActiveLineFor10DlcAssignment(ownerUserId, orgId),
    resolvePrimaryBusinessLineForOrganization(ownerUserId, orgId),
  ])

  if (activeFrom) {
    const owned = await isTelnyxOwnedNumber(activeFrom)
    if (!owned) {
      return {
        ok: false,
        reason: "invalid_line",
        message: `${formatPhoneDisplay(activeFrom)} is listed for this business but is not active on Telnyx for SMS. Open Settings → Lines to fix the line, or share the setup link manually.`,
        intended_number: activeFrom,
        label: primary.label,
      }
    }
    return { ok: true, from_e164: activeFrom, label: primary.label }
  }

  if (primary.awaiting_port && primary.number) {
    const display = formatPhoneDisplay(primary.number)
    return {
      ok: false,
      reason: "porting",
      message: `Your business line ${display} is still transferring to Lyncr. Invite texts will send automatically once the port is complete. For now, copy the setup link below and text it to your technician.`,
      intended_number: primary.number,
      label: primary.label,
    }
  }

  if (primary.number) {
    return {
      ok: false,
      reason: "invalid_line",
      message: `${formatPhoneDisplay(primary.number)} is not ready to send SMS yet. Finish activating it under Settings → Lines, or share the setup link manually.`,
      intended_number: primary.number,
      label: primary.label,
    }
  }

  return {
    ok: false,
    reason: "no_line",
    message:
      "This workspace has no business line for SMS yet. Buy or port a number under Settings → Lines, or share the setup link manually.",
    intended_number: null,
    label: null,
  }
}
