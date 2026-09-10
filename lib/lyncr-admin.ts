// Platform admin access for the Lyncr operator console.
//
// admin@lyncr.app is the bootstrap admin — always treated as one regardless of the DB flag,
// so the account can never lock itself out (e.g. a bad migration, a mistyped UPDATE). Every
// other admin is granted via users.is_platform_admin, a data change (see /admin/users) rather
// than a code change / redeploy.

import type { User } from "@/lib/types"

/** The bootstrap admin — always an admin, independent of the is_platform_admin flag. */
export const LYNCR_ADMIN_EMAIL = "admin@lyncr.app"

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isLyncrAdminEmail(email: string): boolean {
  return normalizeEmail(email) === LYNCR_ADMIN_EMAIL
}

/** True for the bootstrap admin OR any user granted is_platform_admin in the database. */
export function isLyncrAdminUser(user: Pick<User, "email" | "is_platform_admin">): boolean {
  return user.is_platform_admin === true || isLyncrAdminEmail(user.email)
}
