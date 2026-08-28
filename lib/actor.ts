// One answer, for the whole app, to: who is this, whose account are they touching, and
// what may they do here?
//
// The app had four separate answers — a raw session id that silently meant "owner", the
// owner/receptionist actor, a field-tech context with no permission model at all, and a
// hardcoded admin email — so "who can see this?" had to be re-derived per route, and a
// mistake in any one of them was invisible from the others.
//
// There is one hierarchy, and each level is a ceiling on the next:
//
//   platform admin   decides what an ACCOUNT may do; sees platform-level things
//                    nobody else can. NOT a key to the business's records —
//                    the business owns its data.
//        ↓
//   owner            everything the platform allows on their own account;
//                    decides what their staff may do
//        ↓
//   receptionist     what the owner granted, capped by the platform ceiling
//   field tech       same shape — capability model still to come
//
// effective = platform grants ∩ actor grants, computed once, here. A route asks for the
// capability it needs and gets a yes or a null; it never reasons about roles. When
// something is wrong with access, this file is where to look.

import { getUserIdFromRequest } from "@/lib/auth"
import { getPlatformAccountGrantsRaw, getUser } from "@/lib/db"
import { isLyncrAdminUser } from "@/lib/lyncr-admin"
import {
  getReceptionistPortalContext,
  isReceptionistPortalUser,
} from "@/lib/receptionist-portal-auth"
import {
  ALL_CAPABILITIES_GRANTED,
  parseReceptionistCapabilities,
} from "@/lib/receptionist-capabilities"
import {
  ALL_PLATFORM_GRANTS,
  intersectGrants,
  parsePlatformAccountGrants,
  type PlatformAccountGrants,
} from "@/lib/platform-account-grants"
import type { ReceptionistCapabilities } from "@/lib/types"

export type ActorRole = "platform_admin" | "owner" | "receptionist" | "field_tech"

export type Actor = {
  /** Account the rows belong to — always the business owner, whoever is acting. */
  ownerUserId: string
  /** Signed-in user performing the action. */
  actingUserId: string
  actorRole: ActorRole
  /** Receptionist row id when a receptionist is acting, for attribution. */
  receptionistId: string | null
  receptionistName: string | null
  /** What this actor may do here — already capped by the platform ceiling. */
  capabilities: ReceptionistCapabilities
  /** What the platform allows this ACCOUNT at all, before the staff layer. */
  platformGrants: PlatformAccountGrants
}

export type ResolveActorOptions = {
  /**
   * Capability this request requires. Omit for surfaces every linked member of the
   * business gets by default — answering the phone and writing down who called.
   */
  capability?: keyof ReceptionistCapabilities
}

/** Load the platform ceiling for an account. Absent column / row reads as fully granted. */
async function platformGrantsFor(ownerUserId: string): Promise<PlatformAccountGrants> {
  return parsePlatformAccountGrants(await getPlatformAccountGrantsRaw(ownerUserId))
}

/**
 * Resolve the actor behind a request, and whether they may do `capability`.
 *
 * Returns null when there is no session, the user is gone, the role is not admitted, or
 * the capability is denied at either level. Callers treat null as 401/403 and do nothing.
 */
export async function resolveActor(
  cookieHeader: string | null,
  options: ResolveActorOptions = {}
): Promise<Actor | null> {
  const sessionUserId = getUserIdFromRequest(cookieHeader)
  if (!sessionUserId) return null

  const user = await getUser(sessionUserId)
  if (!user) return null

  // Platform admin: master of what accounts MAY DO, not of what they hold. Uncapped,
  // because the ceiling is the thing they set.
  //
  // ownerUserId is their OWN id, deliberately. The business owns its data, so admin rights
  // must not quietly widen into a read of someone's customer book: every workspace route
  // scopes by ownerUserId, so this alone keeps admin out of tenant records. Seeing a
  // business's console stays an explicit, auditable act — /api/admin/impersonate — rather
  // than a side effect of being an admin. If a route ever needs to act on another account,
  // it must take that account as an argument and say so, in the open.
  if (isLyncrAdminUser(user)) {
    return {
      ownerUserId: sessionUserId,
      actingUserId: sessionUserId,
      actorRole: "platform_admin",
      receptionistId: null,
      receptionistName: null,
      capabilities: ALL_CAPABILITIES_GRANTED,
      platformGrants: ALL_PLATFORM_GRANTS,
    }
  }

  if (isReceptionistPortalUser(user)) {
    // A receptionist acts on the business she is linked to, never her own account.
    const ctx = await getReceptionistPortalContext(sessionUserId)
    if (!ctx) return null

    const platformGrants = await platformGrantsFor(ctx.owner_user_id)
    // Both ceilings apply: what the owner gave her, capped by what the platform allows
    // the account. A grant the owner cannot exercise is not one she can inherit.
    const capabilities = intersectGrants(
      platformGrants,
      parseReceptionistCapabilities(ctx.receptionist.capabilities)
    )
    if (options.capability && capabilities[options.capability] !== true) return null

    return {
      ownerUserId: ctx.owner_user_id,
      actingUserId: sessionUserId,
      actorRole: "receptionist",
      receptionistId: ctx.receptionist.id,
      receptionistName: ctx.receptionist.name?.trim() || null,
      capabilities,
      platformGrants,
    }
  }

  // Field techs work jobs; they do not run the front desk. They get their own capability
  // model and their own resolver seam rather than being quietly folded in here — see
  // lib/field-tech-auth.ts. Refusing is the honest answer until that exists.
  if (user.account_role !== "owner") return null

  const platformGrants = await platformGrantsFor(sessionUserId)
  // An owner has everything their account is allowed — no staff layer above them.
  if (options.capability && platformGrants[options.capability] !== true) return null

  return {
    ownerUserId: sessionUserId,
    actingUserId: sessionUserId,
    actorRole: "owner",
    receptionistId: null,
    receptionistName: null,
    capabilities: platformGrants,
    platformGrants,
  }
}
