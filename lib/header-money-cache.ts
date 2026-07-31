/**
 * Shared Stripe Connect "In account" cache for header chip + Money sheet.
 * Dual-writes sessionStorage + paint cookie so SSR/hard refresh can seed.
 */

import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

export const HEADER_MONEY_CACHE_SCOPE = "header-money"
export const HEADER_MONEY_SESSION_KEY = persistedCacheKey(HEADER_MONEY_CACHE_SCOPE, "balance")
export const HEADER_MONEY_COOKIE = paintSeedCookieName(HEADER_MONEY_CACHE_SCOPE)

export type HeaderMoneyCache = {
  availableCents: number
  todayCents: number
  weekCents: number
  monthCents: number
  allTimeCents: number
  connectReady: boolean
}

function isValidMoneyCache(cached: HeaderMoneyCache | null | undefined): cached is HeaderMoneyCache {
  return Boolean(cached && typeof cached.availableCents === "number")
}

/**
 * SessionStorage first, then optional SSR paint seed, then document cookie.
 * Pass `paint` from useDashboardPaintSeeds().money during React render/SSR.
 */
export function readHeaderMoneyCache(
  cookieRaw?: string | null,
  paint?: HeaderMoneyCache | null
): HeaderMoneyCache | null {
  const fromSession = readPersistedCache<HeaderMoneyCache>(HEADER_MONEY_SESSION_KEY)
  if (isValidMoneyCache(fromSession)) return fromSession

  if (isValidMoneyCache(paint)) return paint

  if (cookieRaw !== undefined) {
    const fromServer = readPaintSeedCookieValue<HeaderMoneyCache>(cookieRaw)
    return isValidMoneyCache(fromServer) ? fromServer : null
  }

  const fromCookie = readPaintSeedCookie<HeaderMoneyCache>(HEADER_MONEY_CACHE_SCOPE)
  return isValidMoneyCache(fromCookie) ? fromCookie : null
}

/** Persist after a successful balance/collected fetch (session + cookie). */
export function writeHeaderMoneyCache(next: HeaderMoneyCache): void {
  writePersistedCache(HEADER_MONEY_SESSION_KEY, next)
  writePaintSeedCookie(HEADER_MONEY_CACHE_SCOPE, next)
}

/** Client-safe currency label for the header chip. */
export function formatHeaderMoneyCents(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })
}
