// Who may act on a capability-gated feature (dispatching, invoicing, …), and whose account
// those actions belong to.
//
// Generalizes lib/intake-write-auth.ts's owner/receptionist resolution: that file only ever
// distinguishes role (any receptionist can take intake). Some features are opt-in per
// receptionist on top of the role check — dispatching is the first — so this takes the
// specific capability required and refuses a receptionist who doesn't have it turned on,
// while an owner always passes regardless.

import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import {
  getReceptionistPortalContext,
  isReceptionistPortalUser,
} from "@/lib/receptionist-portal-auth"
import type { ReceptionistCapabilities } from "@/lib/types"

export type CapabilityActor = {
  /** Account the action belongs to — always the business owner. */
  ownerUserId: string
  /** Signed-in user performing the action; equals ownerUserId when the owner does it. */
  actingUserId: string
  actorRole: "owner" | "receptionist"
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
  const sessionUserId = getUserIdFromRequest(cookieHeader)
  if (!sessionUserId) return null

  const user = await getUser(sessionUserId)
  if (!user) return null

  if (isReceptionistPortalUser(user)) {
    const ctx = await getReceptionistPortalContext(sessionUserId)
    if (!ctx) return null
    if (ctx.receptionist.capabilities[capability] !== true) return null
    return {
      ownerUserId: ctx.owner_user_id,
      actingUserId: sessionUserId,
      actorRole: "receptionist",
      receptionistId: ctx.receptionist.id,
    }
  }

  // Field techs and any future role are refused rather than defaulting to owner.
  if (user.account_role !== "owner") return null

  return {
    ownerUserId: sessionUserId,
    actingUserId: sessionUserId,
    actorRole: "owner",
    receptionistId: null,
  }
}
