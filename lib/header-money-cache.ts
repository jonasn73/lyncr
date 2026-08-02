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
 * Lead with today’s collected (what customers paid). Pending/Available belong
 * in the Money sheet under “Get paid,” not as the daily headline.
 */
export type HeaderWalletChipDisplay = {
  /** Big number on the chip. */
  amountCents: number
  /**
   * today — customers paid today (primary daily story)
   * in_account — no sales today, but transferable balance exists
   * zero — nothing today and nothing ready
   */
  mode: "today" | "in_account" | "zero"
  /** Short subtitle under the amount (e.g. “Today”, “In account”). */
  label: string
}

/**
 * Pick the chip amount + label.
 * 1) Collected today > 0 → show that (label “Today”)
 * 2) Else Available > 0 → show Available (label “In account”)
 * 3) Else $0 with label “Today”
 */
export function resolveHeaderWalletChipDisplay(
  availableCents: number,
  _pendingCents: number,
  todayCents: number | null | undefined
): HeaderWalletChipDisplay {
  const available = Number.isFinite(availableCents) ? Math.max(0, availableCents) : 0
  const today =
    todayCents != null && Number.isFinite(todayCents) ? Math.max(0, todayCents) : null

  // Daily story first — what customers paid today.
  if (today != null && today > 0) {
    return { amountCents: today, mode: "today", label: "Today" }
  }

  // Quiet day — show money already ready to transfer, if any.
  if (available > 0) {
    return { amountCents: available, mode: "in_account", label: "In account" }
  }

  // Flat zero — still label “Today” so the chip reads as a daily glance.
  return { amountCents: 0, mode: "zero", label: "Today" }
}
