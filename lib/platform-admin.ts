// ============================================
// Platform admin access (operator console)
// ============================================
// Admins are users with `is_platform_admin` on `users` and/or an email listed in
// `ZING_ADMIN_EMAILS` (comma-separated, case-insensitive).

import type { User } from "./types"

/** Emails allowed to use `/admin` when the DB flag is false (useful for first bootstrap). */
export function getPlatformAdminEmailAllowlist(): Set<string> {
  const raw = process.env.ZING_ADMIN_EMAILS ?? ""
  const set = new Set<string>()
  for (const part of raw.split(",")) {
    const e = part.trim().toLowerCase()
    if (e) set.add(e)
  }
  return set
}

/** True when this signed-in user may call admin APIs and open `/admin`. */
export function isPlatformAdminUser(user: Pick<User, "email" | "is_platform_admin">): boolean {
  if (user.is_platform_admin) return true
  const allow = getPlatformAdminEmailAllowlist()
  return allow.has(user.email.trim().toLowerCase())
}
