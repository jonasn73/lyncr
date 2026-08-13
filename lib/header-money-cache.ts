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
  /** Settled sales for the previous local calendar day (Money sheet “Yesterday”). */
  yesterdayCents: number
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
  // Older cookies omitted yesterdayCents — treat as 0 so we still seed periods.
  if (typeof cached.yesterdayCents !== "number" || !Number.isFinite(cached.yesterdayCents)) {
    cached.yesterdayCents = 0
  }
  return true
}

/**
 * Paint seed first (SSR HTML), then session, then document cookie.
 * Pass `paint` from useDashboardPaintSeeds().money during React render/SSR.
 * Prefer paint over session when both exist (React #418).
 * useLayoutEffect may call with no paint arg to upgrade from session after hydrate.
 */
export function readHeaderMoneyCache(
  cookieRaw?: string | null,
  paint?: HeaderMoneyCache | null
): HeaderMoneyCache | null {
  if (isValidMoneyCache(paint)) return paint

  const fromSession = readPersistedCache<HeaderMoneyCache>(HEADER_MONEY_SESSION_KEY)
  if (isValidMoneyCache(fromSession)) return fromSession

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
 * Rough “your cut” after Lyncr’s card fee (default 2.9% + $0.30), treating
 * the gross as one charge. Real fees are per card payment — good enough for
 * a daily glance, not a bank statement.
 */
export function estimateLyncrNetFromGrossCents(grossCents: number): number {
  const amount = Number.isFinite(grossCents) ? Math.max(0, Math.round(grossCents)) : 0
  if (amount <= 0) return 0
  // Match server defaults in lib/stripe-connect.ts (client has no env overrides).
  const fee = Math.min(amount - 1, Math.round((amount * 290) / 10000) + 30)
  return Math.max(0, amount - Math.max(0, fee))
}

/**
 * What the header wallet chip should show at a glance.
 * Always Stripe Connect wallet (Available → Pending → $0) — never “sales today”.
 * Swapping to today’s sales made $1 test charges look like ~$196 “vanished”.
 * Today / yesterday sales live in the Money sheet (separate from wallet balance).
 */
export type HeaderWalletChipDisplay = {
  /** Big number on the chip = money still in Stripe for this shop. */
  amountCents: number
  /**
   * in_account — transferable Stripe available balance
   * pending — funds still clearing (not yet available)
   * zero — nothing ready and nothing pending
   */
  mode: "in_account" | "pending" | "zero"
  /** Longer wording for aria / tooltips. */
  label: string
  /** Aria/tooltip only — the visible chip is just the $ amount. */
  chipLabel: string
}

/**
 * Pick which amount the chip shows.
 * 1) Available > 0 → Available (ready to transfer / in Stripe)
 * 2) Else Pending > 0 → Pending (clearing — not a fake $0)
 * 3) Else $0
 *
 * `todayCents` is ignored for the chip amount (kept on the signature so older
 * call sites keep compiling). Sales totals belong in Money → Customers paid.
 */
export function resolveHeaderWalletChipDisplay(
  availableCents: number,
  pendingCents: number,
  _todayCents?: number | null
): HeaderWalletChipDisplay {
  const available = Number.isFinite(availableCents) ? Math.max(0, availableCents) : 0
  const pending = Number.isFinite(pendingCents) ? Math.max(0, pendingCents) : 0

  // Money already ready to send to the bank.
  if (available > 0) {
    return {
      amountCents: available,
      mode: "in_account",
      label: "In Stripe · available",
      chipLabel: "Available",
    }
  }

  // Card pays still clearing — show that $ so the chip is not a fake $0.
  // Do not print “Pending” on the chip (that word belongs on each transaction).
  if (pending > 0) {
    return {
      amountCents: pending,
      mode: "pending",
      label: "In Stripe · still clearing",
      chipLabel: "In Stripe",
    }
  }

  return {
    amountCents: 0,
    mode: "zero",
    label: "In Stripe · empty",
    chipLabel: "In Stripe",
  }
}
