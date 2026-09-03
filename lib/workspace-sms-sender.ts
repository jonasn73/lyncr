// Resolve which business line should send outbound SMS for one workspace.
// Never silently pick another shop's line — multi-shop owners must pass organizationId.

import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  countRealOrganizationsForOwner,
  getDefaultOrganizationForOwner,
} from "@/lib/db"
import {
  resolveActiveLineFor10DlcAssignment,
  resolvePrimaryBusinessLineForOrganization,
} from "@/lib/primary-business-line"
import { isTelnyxOwnedNumber } from "@/lib/telnyx-messaging-config"

export type WorkspaceSmsSenderBlockReason =
  | "porting"
  | "no_line"
  | "invalid_line"
  | "missing_shop"
  | "cross_shop"

export type WorkspaceSmsSenderResult =
  | { ok: true; from_e164: string; label: string | null; organization_id: string }
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
 * Resolve which shop to send from.
 * - Explicit org → that shop only
 * - Missing org + one shop → that shop
 * - Missing org + multiple shops → block (never guess across businesses)
 */
async function resolveSmsShopOrganizationId(
  ownerUserId: string,
  organizationId?: string | null
): Promise<
  | { ok: true; organizationId: string; usedDefault: boolean }
  | { ok: false; reason: "missing_shop"; message: string }
> {
  const explicit = normalizeOrgId(organizationId)
  if (explicit) return { ok: true, organizationId: explicit, usedDefault: false }

  const shopCount = await countRealOrganizationsForOwner(ownerUserId)
  if (shopCount > 1) {
    const message =
      "SMS blocked: this account has more than one shop, and no shop was specified. Lyncr will not guess another business’s line — open the job from the right shop and try again."
    console.error("[SMS GUARD] Cross-shop send blocked — missing organizationId", {
      ownerUserId,
      shopCount,
    })
    return { ok: false, reason: "missing_shop", message }
  }

  const def = await getDefaultOrganizationForOwner(ownerUserId)
  const id = def && !def.id.startsWith("legacy-") ? def.id : null
  if (!id) {
    const message =
      "SMS blocked: no shop is set up for this account yet. Add a business under Settings, then try again."
    console.error("[SMS GUARD] No shop for SMS send", { ownerUserId })
    return { ok: false, reason: "missing_shop", message }
  }
  return { ok: true, organizationId: id, usedDefault: true }
}

/**
 * Pick the outbound SMS "from" line for one shop.
 * Uses only carrier-live active DIDs for that business — never another workspace's line.
 * Account-wide “oldest line” fallback is intentionally removed.
 */
export async function resolveWorkspaceSmsSender(
  ownerUserId: string,
  organizationId?: string | null
): Promise<WorkspaceSmsSenderResult> {
  const shop = await resolveSmsShopOrganizationId(ownerUserId, organizationId)
  if (!shop.ok) {
    return {
      ok: false,
      reason: shop.reason,
      message: shop.message,
      intended_number: null,
      label: null,
    }
  }
  if (shop.usedDefault) {
    console.warn("[SMS GUARD] No shop on send — using the only / default shop", {
      ownerUserId,
      organizationId: shop.organizationId,
    })
  }

  const orgId = shop.organizationId
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
    return {
      ok: true,
      from_e164: activeFrom,
      label: primary.label,
      organization_id: orgId,
    }
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
