// Shared gate for Vercel cron routes (same rule as /api/cron/sync-presence).

/** True when the request may run a cron job. */
export function isAuthorizedCronRequest(req: { headers: { get(name: string): string | null } }): boolean {
  // Vercel sets CRON_SECRET and sends Authorization: Bearer <secret>.
  const secret = process.env.CRON_SECRET?.trim()
  // If the secret is not configured yet, match existing Lyncr crons (allow the tick).
  if (!secret) return true
  // Compare the full Bearer header — do not parse the token another way.
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}
