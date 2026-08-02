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
  /** Stripe Connect funds not yet ready to transfer (usually 1–2 business days). */
  pendingCents: number
  todayCents: number
  weekCents: number
  monthCents: number
  allTimeCents: number
  connectReady: boolean
}

function isValidMoneyCache(cached: HeaderMoneyCache | null | undefined): cached is HeaderMoneyCache {
  if (!cached || typeof cached.availableCents !== "number") return false
  // Older cookies omitted pendingCents — treat as 0 so we still seed the chip.
  if (typeof cached.pendingCents !== "number" || !Number.isFinite(cached.pendingCents)) {
    cached.pendingCents = 0
  }
  return true
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

/**
 * What the header wallet chip should show at a glance.
 * When Available is $0 but Pending has money, lead with Pending so the chip
 * “counts up” as cards / pay links clear — not a confusing stuck $0.
 */
export type HeaderWalletChipDisplay = {
  /** Big number on the chip (Available, or Pending when that is the story). */
  amountCents: number
  /** Chip subtitle: PENDING (amber) vs IN ACCOUNT (emerald). */
  mode: "pending" | "in_account"
  /** Extra line when Available > 0 and Pending > 0 (e.g. “+$89 pending”). */
  pendingHint: string | null
}

/** Pick the chip amount + label from Stripe Connect Available / Pending. */
export function resolveHeaderWalletChipDisplay(
  availableCents: number,
  pendingCents: number
): HeaderWalletChipDisplay {
  // Normalize bad/NaN values so the chip never shows garbage.
  const available = Number.isFinite(availableCents) ? Math.max(0, availableCents) : 0
  const pending = Number.isFinite(pendingCents) ? Math.max(0, pendingCents) : 0

  // Money is clearing but nothing is transferable yet — show Pending big.
  if (pending > 0 && available <= 0) {
    return { amountCents: pending, mode: "pending", pendingHint: null }
  }

  // Ready-to-transfer money exists — show Available; mention Pending if any.
  if (available > 0 && pending > 0) {
    return {
      amountCents: available,
      mode: "in_account",
      pendingHint: `+${formatHeaderMoneyCents(pending)} pending`,
    }
  }

  // Flat $0 or Available-only with no Pending.
  return { amountCents: available, mode: "in_account", pendingHint: null }
}
