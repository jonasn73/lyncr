/**
 * Resolve the Neon connection string for serverless HTTP queries.
 * Prefer the pooled endpoint (DATABASE_URL_POOLED) to avoid cold connection overhead on voice webhooks.
 */

/** True when the hostname already points at Neon's connection pooler. */
function isNeonPoolerHost(hostname: string): boolean {
  return hostname.includes("-pooler.") || hostname.includes(".pooler.")
}

/**
 * Rewrite a direct Neon endpoint host to the `-pooler` variant when possible.
 * Example: ep-foo.us-east-2.aws.neon.tech → ep-foo-pooler.us-east-2.aws.neon.tech
 *
 * Only touches real Neon hostnames. SETUP-DATABASE.md documents Supabase and "any Postgres"
 * (including a local instance for tests) as supported DATABASE_URL targets too — blindly
 * splicing "-pooler" into hostParts[0] previously corrupted any of those (e.g. 127.0.0.1
 * became 127-pooler.0.0.1, an unresolvable host) since it assumed every hostname followed
 * Neon's ep-xxx.<region>.aws.neon.tech shape.
 */
function toNeonPoolerUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.endsWith(".neon.tech")) return url
    if (isNeonPoolerHost(parsed.hostname)) return url
    const hostParts = parsed.hostname.split(".")
    if (hostParts.length < 2) return url
    hostParts[0] = `${hostParts[0]}-pooler`
    parsed.hostname = hostParts.join(".")
    return parsed.toString()
  } catch {
    return url
  }
}

/** Pick the fastest Neon URL available in env (pooled first). */
export function resolveNeonDatabaseUrl(): string {
  const pooled = process.env.DATABASE_URL_POOLED?.trim()
  if (pooled) return pooled

  const direct = process.env.DATABASE_URL?.trim()
  if (!direct) {
    throw new Error(
      "DATABASE_URL is not set. Add it in Vercel → Settings → Environment Variables (and in .env.local for local dev)."
    )
  }

  const forceDirect = ["1", "true", "yes", "on"].includes(
    (process.env.NEON_USE_DIRECT_CONNECTION || "").trim().toLowerCase()
  )
  if (forceDirect) return direct

  const autoPool = process.env.NEON_AUTO_POOLER !== "0"
  if (autoPool) return toNeonPoolerUrl(direct)

  return direct
}
