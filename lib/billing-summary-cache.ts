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

export const BILLING_SUMMARY_CACHE_SCOPE = "billing-summary"
export const BILLING_SUMMARY_SESSION_KEY = persistedCacheKey(BILLING_SUMMARY_CACHE_SCOPE, "default")
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
  if (isValid(paint)) return paint

  const fromSession = readPersistedCache<BillingSummaryCache>(BILLING_SUMMARY_SESSION_KEY)
  if (isValid(fromSession)) return fromSession

  if (cookieRaw !== undefined) {
    const fromServer = readPaintSeedCookieValue<BillingSummaryCache>(cookieRaw)
    return isValid(fromServer) ? fromServer : null
  }

  const fromCookie = readPaintSeedCookie<BillingSummaryCache>(BILLING_SUMMARY_CACHE_SCOPE)
  return isValid(fromCookie) ? fromCookie : null
}

/** Persist after a successful billing summary fetch (session + compact cookie). */
export function writeBillingSummaryCache(next: BillingSummaryCache): void {
  writePersistedCache(BILLING_SUMMARY_SESSION_KEY, next)
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
  } satisfies Partial<BillingSummaryCache>)
}
