// Who may act on a capability-gated feature (dispatching, invoicing, …), and whose account
// those actions belong to.
//
// Narrow view of lib/workspace-actor.ts kept for the routes already written against it:
// same owner-always / receptionist-only-when-opted-in rule, without the capability map on
// the result. New routes should call resolveWorkspaceActor directly.

import { resolveWorkspaceActor } from "@/lib/workspace-actor"
import type { ActorRole } from "@/lib/actor"
import type { ReceptionistCapabilities } from "@/lib/types"

export type CapabilityActor = {
  /** Account the action belongs to — always the business owner. */
  ownerUserId: string
  /** Signed-in user performing the action; equals ownerUserId when the owner does it. */
  actingUserId: string
  actorRole: ActorRole
  receptionistId: string | null
}

/**
 * Resolve who is acting on a capability-gated route.
 *
 * An owner always passes. A receptionist passes only when `capability` is turned on for
 * her specific row — everyone else (field techs, no session, a receptionist without the
 * flag) gets null. Callers should treat null as 401/403 and do nothing.
 */
export async function resolveCapabilityActor(
  cookieHeader: string | null,
  capability: keyof ReceptionistCapabilities
): Promise<CapabilityActor | null> {
  const actor = await resolveWorkspaceActor(cookieHeader, { capability })
  if (!actor) return null
  return {
    ownerUserId: actor.ownerUserId,
    actingUserId: actor.actingUserId,
    actorRole: actor.actorRole,
    receptionistId: actor.receptionistId,
  }
}
