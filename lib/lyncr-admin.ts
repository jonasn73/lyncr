// Exclusive operator access for the Lyncr platform admin console.

import type { User } from "@/lib/types"

/** Only this email may open /admin and call admin API routes. */
export const LYNCR_ADMIN_EMAIL = "admin@lyncr.app"

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isLyncrAdminEmail(email: string): boolean {
  return normalizeEmail(email) === LYNCR_ADMIN_EMAIL
}

export function isLyncrAdminUser(user: Pick<User, "email">): boolean {
  return isLyncrAdminEmail(user.email)
}
