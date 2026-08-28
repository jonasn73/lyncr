// The single answer to "whose workspace is this request acting on, and may it?".
//
// Owner and receptionist consoles are meant to be a mirror: the receptionist sees the
// owner's rows, not her own. Everything hinges on how a route resolves the account, and
// there were two answers in the codebase — getUserIdFromRequest (the session user, which
// silently means "owner"), and the two narrow helpers built for intake and dispatch.
// A receptionist hitting a getUserIdFromRequest route queried her OWN account: no
// business, no customers, no jobs. That is why the two consoles had to be built twice.
//
// This is the one resolver both of those helpers now delegate to, and the one workspace
// data routes should call. It always returns the OWNER's id as the account to read and
// write, plus who is actually acting, so attribution stays honest.
//
// Roles it admits:
//   owner        — always, with every capability granted
//   receptionist — only when linked to a business, and only when `capability` is on
//   anyone else  — refused (field techs work jobs; they do not run the front desk)

import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import {
  getReceptionistPortalContext,
  isReceptionistPortalUser,
} from "@/lib/receptionist-portal-auth"
import {
  ALL_CAPABILITIES_GRANTED,
  parseReceptionistCapabilities,
} from "@/lib/receptionist-capabilities"
import type { ReceptionistCapabilities } from "@/lib/types"

export type WorkspaceActor = {
  /** Account the rows belong to — always the business owner. */
  ownerUserId: string
  /** Signed-in user performing the action; equals ownerUserId when the owner does it. */
  actingUserId: string
  actorRole: "owner" | "receptionist"
  /** Receptionist row id when a receptionist is acting, for attribution. */
  receptionistId: string | null
  receptionistName: string | null
  /** What this actor may do. Every flag is true for an owner. */
  capabilities: ReceptionistCapabilities
}

export type ResolveWorkspaceActorOptions = {
  /**
   * Capability a receptionist must have turned on for this request. Omit for surfaces
   * every linked receptionist gets by default (intake — she answers the phone).
   */
  capability?: keyof ReceptionistCapabilities
}

/**
 * Resolve the workspace account a request acts on from the session cookie.
 *
 * Returns null when there is no session, the user is gone, the role is not admitted, or
 * the receptionist lacks the required capability. Callers should treat null as 401/403
 * and neither read nor write.
 *
 * Costs one user lookup on the owner path that a cookie-only check did not, plus the
 * portal context lookup on the receptionist path. Workspace routes are per-interaction,
 * not per-frame, and the alternative is guessing at the role.
 */
export async function resolveWorkspaceActor(
  cookieHeader: string | null,
  options: ResolveWorkspaceActorOptions = {}
): Promise<WorkspaceActor | null> {
  const sessionUserId = getUserIdFromRequest(cookieHeader)
  if (!sessionUserId) return null

  const user = await getUser(sessionUserId)
  if (!user) return null

  if (isReceptionistPortalUser(user)) {
    // A receptionist acts on the business she is linked to, never her own account.
    const ctx = await getReceptionistPortalContext(sessionUserId)
    if (!ctx) return null

    const capabilities = parseReceptionistCapabilities(ctx.receptionist.capabilities)
    if (options.capability && capabilities[options.capability] !== true) return null

    return {
      ownerUserId: ctx.owner_user_id,
      actingUserId: sessionUserId,
      actorRole: "receptionist",
      receptionistId: ctx.receptionist.id,
      receptionistName: ctx.receptionist.name?.trim() || null,
      capabilities,
    }
  }

  // Field techs and any future role are refused rather than defaulting to owner.
  if (user.account_role !== "owner") return null

  return {
    ownerUserId: sessionUserId,
    actingUserId: sessionUserId,
    actorRole: "owner",
    receptionistId: null,
    receptionistName: null,
    capabilities: ALL_CAPABILITIES_GRANTED,
  }
}
