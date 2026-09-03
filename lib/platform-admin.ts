// ============================================
// Platform admin access (operator console)
// ============================================
// Only admin@lyncr.app may access /admin (see lib/lyncr-admin.ts).

import type { User } from "./types"
import { isLyncrAdminUser } from "./lyncr-admin"

/** True when this signed-in user may call admin APIs and open `/admin`. */
// NOTE: despite the name, this does not consult users.is_platform_admin — it delegates to
// isLyncrAdminUser, which tests the email against the Lyncr admin allowlist. The parameter
// used to demand is_platform_admin as well, which was misleading (the field is never read)
// and forced callers holding a partial user to fabricate one. Narrowed to what it uses.
// Behaviour is unchanged; whether the DB flag SHOULD also grant access is a separate
// question and deliberately not decided here.
export function isPlatformAdminUser(user: Pick<User, "email">): boolean {
  return isLyncrAdminUser(user)
}

/** Session user fields used for global (non-workspace) platform operator checks. */
export type GlobalPlatformSessionUser = {
  email?: string | null
  globalRole?: string | null
  isPlatformAdmin?: boolean
}

/**
 * True for platform-wide super admins only — not business owners.
 * Matches session `globalRole` / `isPlatformAdmin` or the operator email allowlist.
 */
export function isGlobalPlatformAdmin(user: GlobalPlatformSessionUser | null | undefined): boolean {
  if (!user) return false
  if (user.isPlatformAdmin === true) return true
  if (user.globalRole === "PLATFORM_ADMIN") return true
  if (user.email && isLyncrAdminUser({ email: user.email })) return true
  return false
}

/** Build global session fields from a database user row. */
export function globalPlatformSessionFields(user: Pick<User, "email" | "is_platform_admin">) {
  const isPlatformAdmin = isPlatformAdminUser(user)
  return {
    isPlatformAdmin,
    globalRole: isPlatformAdmin ? ("PLATFORM_ADMIN" as const) : null,
  }
}
