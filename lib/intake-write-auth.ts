// Who may write intake records, and whose account those records land under.
//
// Intake writes (customer, vehicle, manual call log, job) were resolved with
// getUserIdFromRequest and written under that id directly, which silently assumed the
// caller was the business owner. A receptionist answering the phone would have written
// under her own account — one with no business, no customers, and no jobs.
//
// Intake is the one surface every linked receptionist gets without an owner opt-in: she
// answers the phone, so she must be able to write down who called. Anything beyond that
// is capability-gated — see lib/workspace-actor.ts, which this now delegates to.

import { resolveWorkspaceActor } from "@/lib/workspace-actor"
import type { ActorRole } from "@/lib/actor"

export type IntakeWriteActor = {
  /** Account the records are written under — always the business owner. */
  ownerUserId: string
  /** Signed-in user performing the write; equals ownerUserId when the owner does it. */
  actingUserId: string
  actorRole: ActorRole
  /** Receptionist row id when a receptionist is acting, for attribution. */
  receptionistId: string | null
  receptionistName: string | null
}

/**
 * Resolve the account an intake write belongs to from the session cookie.
 *
 * Returns null when there is no session, the user is gone, or the role is not allowed to
 * take intake — callers should treat null as 401/403 and write nothing.
 */
export async function resolveIntakeWriteActor(
  cookieHeader: string | null
): Promise<IntakeWriteActor | null> {
  const actor = await resolveWorkspaceActor(cookieHeader)
  if (!actor) return null
  return {
    ownerUserId: actor.ownerUserId,
    actingUserId: actor.actingUserId,
    actorRole: actor.actorRole,
    receptionistId: actor.receptionistId,
    receptionistName: actor.receptionistName,
  }
}
