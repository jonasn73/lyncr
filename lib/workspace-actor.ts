// Workspace-shaped view of lib/actor.ts, kept for the routes already written against it.
//
// This was the first unification — owner vs receptionist on workspace data routes. The
// hierarchy above it (platform admin → owner → staff) now lives in lib/actor.ts, and this
// delegates so every route already using it inherits the platform ceiling without being
// edited. New routes should call resolveActor directly.

import { resolveActor, type ActorRole } from "@/lib/actor"
import type { ReceptionistCapabilities } from "@/lib/types"

export type WorkspaceActor = {
  /** Account the rows belong to — always the business owner. */
  ownerUserId: string
  /** Signed-in user performing the action; equals ownerUserId when the owner does it. */
  actingUserId: string
  actorRole: ActorRole
  /** Receptionist row id when a receptionist is acting, for attribution. */
  receptionistId: string | null
  receptionistName: string | null
  /** What this actor may do — already capped by the platform ceiling. */
  capabilities: ReceptionistCapabilities
}

export type ResolveWorkspaceActorOptions = {
  /**
   * Capability a caller must have for this request. Omit for surfaces every linked member
   * of the business gets by default — intake, because she answers the phone.
   */
  capability?: keyof ReceptionistCapabilities
}

/**
 * Resolve the workspace account a request acts on from the session cookie.
 *
 * Returns null when there is no session, the user is gone, the role is not admitted, or
 * the capability is denied at either level. Callers treat null as 401/403.
 */
export async function resolveWorkspaceActor(
  cookieHeader: string | null,
  options: ResolveWorkspaceActorOptions = {}
): Promise<WorkspaceActor | null> {
  const actor = await resolveActor(cookieHeader, options)
  if (!actor) return null
  return {
    ownerUserId: actor.ownerUserId,
    actingUserId: actor.actingUserId,
    actorRole: actor.actorRole,
    receptionistId: actor.receptionistId,
    receptionistName: actor.receptionistName,
    capabilities: actor.capabilities,
  }
}
