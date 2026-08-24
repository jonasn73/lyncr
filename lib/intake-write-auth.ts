// Who may write intake records, and whose account those records land under.
//
// Intake writes (customer, vehicle, manual call log, job) were resolved with
// getUserIdFromRequest and written under that id directly, which silently assumed the
// caller was the business owner. A receptionist answering the phone would have written
// under her own account — one with no business, no customers, and no jobs.
//
// This is the single place that widens those writes to receptionists. It admits exactly
// two roles and always returns the OWNER's id as the write target, so a receptionist can
// book a job for the business she answers for and nothing else. Field techs are not
// admitted: they work jobs, they do not take intake.
//
// Anything security-relevant about "can a receptionist write this?" should be answered
// here rather than in individual routes.

import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import {
  getReceptionistPortalContext,
  isReceptionistPortalUser,
} from "@/lib/receptionist-portal-auth"

export type IntakeWriteActor = {
  /** Account the records are written under — always the business owner. */
  ownerUserId: string
  /** Signed-in user performing the write; equals ownerUserId when the owner does it. */
  actingUserId: string
  actorRole: "owner" | "receptionist"
  /** Receptionist row id when a receptionist is acting, for attribution. */
  receptionistId: string | null
  receptionistName: string | null
}

/**
 * Resolve the account an intake write belongs to from the session cookie.
 *
 * Returns null when there is no session, the user is gone, or the role is not allowed to
 * take intake — callers should treat null as 401/403 and write nothing.
 *
 * Costs one user lookup on the owner path that the old cookie-only check did not. Intake
 * writes are per-call, not a hot path, and the alternative is guessing at the role.
 */
export async function resolveIntakeWriteActor(
  cookieHeader: string | null
): Promise<IntakeWriteActor | null> {
  const sessionUserId = getUserIdFromRequest(cookieHeader)
  if (!sessionUserId) return null

  const user = await getUser(sessionUserId)
  if (!user) return null

  if (isReceptionistPortalUser(user)) {
    // A receptionist writes under the business she is linked to, never her own account.
    const ctx = await getReceptionistPortalContext(sessionUserId)
    if (!ctx) return null
    return {
      ownerUserId: ctx.owner_user_id,
      actingUserId: sessionUserId,
      actorRole: "receptionist",
      receptionistId: ctx.receptionist.id,
      receptionistName: ctx.receptionist.name?.trim() || null,
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
  }
}
