// Tiny Sentry helpers — safe to unit-test without loading the full SDK.

/** Browser DSN first, then server-only DSN. Empty string means "do not send". */
export function resolveSentryDsn(env: NodeJS.ProcessEnv = process.env): string {
  // Public DSN is required for Replay in the browser.
  const publicDsn = env.NEXT_PUBLIC_SENTRY_DSN?.trim() ?? ""
  // Server can use the same public DSN or a private alias.
  const serverDsn = env.SENTRY_DSN?.trim() ?? ""
  return publicDsn || serverDsn
}

/** Replay + crash reporting only run on the live site, and only when a DSN is set. */
export function shouldEnableSentry(params?: {
  nodeEnv?: string
  dsn?: string
}): boolean {
  // Default to the real process env so callers can omit arguments.
  const nodeEnv = params?.nodeEnv ?? process.env.NODE_ENV ?? "development"
  // Resolve DSN the same way client/server configs do.
  const dsn = params?.dsn ?? resolveSentryDsn()
  // Never send from local `npm run dev` — keep the in-app DevErrorLogDrawer instead.
  return nodeEnv === "production" && dsn.length > 0
}

/** True for React hydration noise we do not want to page on-call about. */
export function isNoisyHydrationWarning(message: string): boolean {
  // Empty strings are not hydration warnings.
  const text = message.trim()
  if (!text) return false
  // Classic Next/React hydration mismatch copy.
  if (/hydrat/i.test(text) && /failed|mismatch|did not match|error while hydrating/i.test(text)) {
    return true
  }
  // Minified hydration codes only — do NOT swallow #185 (render loops) or other real crashes.
  if (/Minified React error #(418|422|423|425)\b/.test(text)) {
    return true
  }
  return false
}

/** Stable short hash of an email so Sentry can group users without storing the address. */
export function hashSentryEmail(email: string): string {
  // Normalize so Admin@Lyncr.app and admin@lyncr.app map to the same id.
  const normalized = email.trim().toLowerCase()
  if (!normalized) return ""
  // Simple FNV-1a 32-bit hash — good enough for grouping, not a password hash.
  let hash = 2166136261
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  // Unsigned hex so the id is a short opaque string.
  return (hash >>> 0).toString(16).padStart(8, "0")
}
