// Receptionist portal — resolve logged-in user → receptionist row + owner business context.

import {
  getAuthUserByEmail,
  getReceptionistByPortalUserId,
  getReceptionists,
  getUser,
  listOrganizationsForOwner,
  tryLinkReceptionistPortalUser,
} from "@/lib/db"
import { SANDBOX_OWNER_EMAIL, SANDBOX_TEST_RECEPTIONIST_EMAIL } from "@/lib/sandbox-engine"
import type { Receptionist, User } from "@/lib/types"

/** Business-owner vs receptionist portal account. */
type AccountRole = "owner" | "receptionist"

export type ReceptionistPortalContext = {
  portal_user: User
  receptionist: Receptionist
  owner_user_id: string
  business_name: string
}

/** Dev sandbox test receptionist login — always routes to receptionist portal, never owner onboarding. */
export function isSandboxTestReceptionistEmail(email: string): boolean {
  return email.trim().toLowerCase() === SANDBOX_TEST_RECEPTIONIST_EMAIL.toLowerCase()
}

/** True when the user row is tagged as a receptionist portal account. */
export function isReceptionistPortalUser(user: Pick<User, "account_role" | "email">): boolean {
  if (isSandboxTestReceptionistEmail(user.email)) return true
  return user.account_role === "receptionist"
}

async function resolveReceptionistForPortalUser(
  portalUserId: string,
  portal_user: User
): Promise<Receptionist | null> {
  const byPortal = await getReceptionistByPortalUserId(portalUserId)
  if (byPortal) return byPortal

  if (!isSandboxTestReceptionistEmail(portal_user.email)) return null

  const ownerAuth = await getAuthUserByEmail(SANDBOX_OWNER_EMAIL)
  if (!ownerAuth) return null

  const team = await getReceptionists(ownerAuth.id)
  const match = team.find((r) => r.name?.trim().toLowerCase() === "test receptionist") ?? null
  if (!match) return null

  await tryLinkReceptionistPortalUser(match.id, ownerAuth.id, portalUserId)
  return { ...match, portal_user_id: portalUserId }
}

/**
 * Load receptionist portal context for the signed-in user.
 * Uses portal_user_id when set; sandbox test receptionist falls back to owner team lookup.
 */
export async function getReceptionistPortalContext(
  portalUserId: string
): Promise<ReceptionistPortalContext | null> {
  const portal_user = await getUser(portalUserId)
  if (!portal_user) return null

  const linked = await resolveReceptionistForPortalUser(portalUserId, portal_user)
  if (!linked) return null

  const owner = await getUser(linked.user_id)
  // Prefer workspace org name (e.g. "Key Squad 502"), then owner business_name.
  let business_name = owner?.business_name?.trim() || "Business line"
  try {
    const orgs = await listOrganizationsForOwner(linked.user_id)
    const defaultOrg = orgs.find((o) => o.is_default) ?? orgs[0]
    const orgName = defaultOrg?.name?.trim()
    if (orgName) business_name = orgName
  } catch {
    /* org lookup optional */
  }

  return {
    portal_user,
    receptionist: linked,
    owner_user_id: linked.user_id,
    business_name,
  }
}
