/**
 * Shared Pay-tab billing summary cache (carrier credit).
 * Dual-writes sessionStorage + paint cookie for hard-refresh seeds.
 */

import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

const BILLING_SUMMARY_CACHE_SCOPE = "billing-summary"
const BILLING_SUMMARY_SESSION_KEY = persistedCacheKey(BILLING_SUMMARY_CACHE_SCOPE, "default")
export const BILLING_SUMMARY_COOKIE = paintSeedCookieName(BILLING_SUMMARY_CACHE_SCOPE)

export type BillingSummaryCache = {
  current_plan: string
  credit_balance_cents: number
  credit_balance_label: string
  telnyx_number_purchase_label: string
  metered_voice_cents_per_minute: number
  suggested_credit_packs_cents: number[]
  subscription_active?: boolean
  subscription_tier?: string
  subscription_tier_label?: string
  needs_carrier_credit?: boolean
  low_balance_notified?: boolean
  low_carrier_credit_warning?: boolean
  low_carrier_credit_threshold_usd?: number
  plans?: { key: string; monthly_price_label: string; included_minutes_per_month: number }[]
  /** epoch ms when this seed was written — cookie reads treat an old one as no-seed. */
  fetchedAtMs?: number
}

/**
 * Same cookie-tier freshness gap as header-money-cache.ts: sessionStorage already self-gates
 * via readPersistedCache's own maxAge envelope, but the cookie/paint tier has no timestamp
 * of its own, so a stale credit balance would render confidently before the live fetch
 * corrected it.
 */
const BILLING_COOKIE_FRESH_MS = 2 * 60 * 1000

function isBillingCookieFresh(cached: BillingSummaryCache | null | undefined, now: number): boolean {
  if (!cached || typeof cached.fetchedAtMs !== "number") return false
  return now - cached.fetchedAtMs <= BILLING_COOKIE_FRESH_MS
}

function isValid(cached: BillingSummaryCache | null | undefined): cached is BillingSummaryCache {
  return Boolean(cached && typeof cached.credit_balance_cents === "number")
}

/**
 * Paint seed first (SSR HTML), then session, then cookie.
 * Pass `paint` from useDashboardPaintSeeds().billing during React render/SSR.
 * Prefer paint over session when both exist (React #418).
 */
export function readBillingSummaryCache(
  cookieRaw?: string | null,
  paint?: BillingSummaryCache | null
): BillingSummaryCache | null {
  const now = Date.now()
  if (isValid(paint) && isBillingCookieFresh(paint, now)) return paint

  // sessionStorage already self-gates via readPersistedCache's own maxAge envelope.
  const fromSession = readPersistedCache<BillingSummaryCache>(BILLING_SUMMARY_SESSION_KEY)
  if (isValid(fromSession)) return fromSession

  if (cookieRaw !== undefined) {
    const fromServer = readPaintSeedCookieValue<BillingSummaryCache>(cookieRaw)
    return isValid(fromServer) && isBillingCookieFresh(fromServer, now) ? fromServer : null
  }

  const fromCookie = readPaintSeedCookie<BillingSummaryCache>(BILLING_SUMMARY_CACHE_SCOPE)
  return isValid(fromCookie) && isBillingCookieFresh(fromCookie, now) ? fromCookie : null
}

/** Persist after a successful billing summary fetch (session + compact cookie). */
export function writeBillingSummaryCache(next: BillingSummaryCache): void {
  const fetchedAtMs = Date.now()
  writePersistedCache(BILLING_SUMMARY_SESSION_KEY, { ...next, fetchedAtMs })
  writePaintSeedCookie(BILLING_SUMMARY_CACHE_SCOPE, {
    current_plan: next.current_plan,
    credit_balance_cents: next.credit_balance_cents,
    credit_balance_label: next.credit_balance_label,
    telnyx_number_purchase_label: next.telnyx_number_purchase_label,
    metered_voice_cents_per_minute: next.metered_voice_cents_per_minute,
    suggested_credit_packs_cents: next.suggested_credit_packs_cents ?? [],
    subscription_active: next.subscription_active,
    subscription_tier: next.subscription_tier,
    needs_carrier_credit: next.needs_carrier_credit,
    low_carrier_credit_warning: next.low_carrier_credit_warning,
    low_carrier_credit_threshold_usd: next.low_carrier_credit_threshold_usd,
    fetchedAtMs,
  } satisfies Partial<BillingSummaryCache>)
}
