// Shared per-IP rate limiting, backed by the Upstash Redis instance connected to this project
// (KV_REST_API_URL / KV_REST_API_TOKEN). Every limiter is a distinct sliding window so one
// endpoint's abuse can't burn another's budget.
//
// Fails open: if Redis is unreachable or unconfigured (e.g. local dev before `vercel env pull`),
// requests are allowed through rather than locking everyone out. This is throttling, not the
// only line of defense — auth/booking/payment routes still do their own checks.

import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

let redis: Redis | null | undefined

function getRedis(): Redis | null {
  if (redis !== undefined) return redis
  const url = process.env.KV_REST_API_URL?.trim()
  const token = process.env.KV_REST_API_TOKEN?.trim()
  if (!url || !token) {
    console.warn("[rate-limit] KV_REST_API_URL/TOKEN not set — rate limiting disabled")
    redis = null
    return redis
  }
  redis = new Redis({ url, token })
  return redis
}

/** Request-per-window limits for each named limiter. Tune here, not at call sites. */
const LIMITER_CONFIG = {
  // Auth: generous enough for a real user mistyping a password a few times, tight enough to
  // blunt credential stuffing / account-takeover probing.
  "auth-login": { limit: 10, windowSeconds: 60 },
  "auth-signup": { limit: 5, windowSeconds: 60 },
  "auth-forgot-password": { limit: 5, windowSeconds: 60 },
  // Booking/intake: public, unauthenticated, and triggers SMS/AI spend per submission.
  booking: { limit: 20, windowSeconds: 60 },
  // AI assistant / geocoding: metered third-party cost per call.
  ai: { limit: 20, windowSeconds: 60 },
  geocoding: { limit: 30, windowSeconds: 60 },
} as const

export type RateLimiterName = keyof typeof LIMITER_CONFIG

const limiters = new Map<RateLimiterName, Ratelimit>()

function getLimiter(name: RateLimiterName): Ratelimit | null {
  const client = getRedis()
  if (!client) return null
  let limiter = limiters.get(name)
  if (!limiter) {
    const { limit, windowSeconds } = LIMITER_CONFIG[name]
    limiter = new Ratelimit({
      redis: client,
      limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
      analytics: true,
      prefix: `lyncr-ratelimit:${name}`,
    })
    limiters.set(name, limiter)
  }
  return limiter
}

/** Best-effort client IP from the headers Vercel/Next.js populate behind its proxy. */
export function clientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return forwardedFor || headers.get("x-real-ip") || "unknown"
}

export type RateLimitResult = { limited: false } | { limited: true; retryAfterSeconds: number }

/**
 * Check and consume one request against `name`'s limiter for `key` (usually the caller's IP,
 * optionally combined with an account identifier for tighter per-account limits). Fails open —
 * see module comment — so a Redis outage degrades to "no rate limiting," not "site down."
 */
export async function checkRateLimit(name: RateLimiterName, key: string): Promise<RateLimitResult> {
  const limiter = getLimiter(name)
  if (!limiter) return { limited: false }
  try {
    const result = await limiter.limit(key)
    if (result.success) return { limited: false }
    const retryAfterSeconds = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
    return { limited: true, retryAfterSeconds }
  } catch (e) {
    console.error(`[rate-limit] ${name} check failed, allowing request:`, e)
    return { limited: false }
  }
}

/** Standard 429 JSON response for a rate-limited request. */
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "Too many requests. Please try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  )
}
