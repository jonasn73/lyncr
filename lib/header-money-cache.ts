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
  /**
   * Money actually in hand right now (charges − reversals − fees − payouts, migrations
   * 155/156) — the header chip's number. Distinct from availableCents/pendingCents, which are
   * Stripe's transfer-eligibility state and still drive the Send to bank panel specifically.
   */
  walletBalanceCents: number
  /** Lifetime Stripe/Lyncr processing fees taken at charge time. Always ≤ 0. */
  lifetimeFeesCents: number
  /** Lifetime money sent to the bank via Send to bank. Always ≤ 0. */
  lifetimePayoutsCents: number
  connectReady: boolean
  /** epoch ms when this seed was written — cookie/paint reads treat an old one as no-seed. */
  fetchedAtMs?: number
}

/**
 * Older than this, the cookie/paint seed's dollar amounts may already be wrong — a payout
 * cleared, a card charge came in — and this is the highest-attention number on every page.
 * Showing it confidently and then rewriting once the live fetch lands is the same
 * "confident value that flips" flash fixed for routing-telemetry-cache. sessionStorage reads
 * already self-gate via readPersistedCache's own 30min envelope; this only covers the cookie
 * tier, which has no timestamp mechanism of its own.
 */
const MONEY_COOKIE_FRESH_MS = 2 * 60 * 1000

function isMoneyCookieFresh(cached: HeaderMoneyCache | null | undefined, now: number): boolean {
  if (!cached || typeof cached.fetchedAtMs !== "number") return false
  return now - cached.fetchedAtMs <= MONEY_COOKIE_FRESH_MS
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
  // Pre-155 cookies have no walletBalanceCents — fall back to availableCents so the chip still
  // seeds something reasonable until the next live fetch lands.
  if (typeof cached.walletBalanceCents !== "number" || !Number.isFinite(cached.walletBalanceCents)) {
    cached.walletBalanceCents = cached.availableCents
  }
  if (typeof cached.lifetimeFeesCents !== "number" || !Number.isFinite(cached.lifetimeFeesCents)) {
    cached.lifetimeFeesCents = 0
  }
  if (typeof cached.lifetimePayoutsCents !== "number" || !Number.isFinite(cached.lifetimePayoutsCents)) {
    cached.lifetimePayoutsCents = 0
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
  const now = Date.now()
  if (isValidMoneyCache(paint) && isMoneyCookieFresh(paint, now)) return paint

  // sessionStorage already self-gates via readPersistedCache's own maxAge envelope.
  const fromSession = readPersistedCache<HeaderMoneyCache>(HEADER_MONEY_SESSION_KEY)
  if (isValidMoneyCache(fromSession)) return fromSession

  if (cookieRaw !== undefined) {
    const fromServer = readPaintSeedCookieValue<HeaderMoneyCache>(cookieRaw)
    return isValidMoneyCache(fromServer) && isMoneyCookieFresh(fromServer, now) ? fromServer : null
  }

  const fromCookie = readPaintSeedCookie<HeaderMoneyCache>(HEADER_MONEY_CACHE_SCOPE)
  return isValidMoneyCache(fromCookie) && isMoneyCookieFresh(fromCookie, now) ? fromCookie : null
}

/** Persist after a successful balance/collected fetch (session + cookie). */
export function writeHeaderMoneyCache(next: HeaderMoneyCache): void {
  const stamped: HeaderMoneyCache = { ...next, fetchedAtMs: Date.now() }
  writePersistedCache(HEADER_MONEY_SESSION_KEY, stamped)
  writePaintSeedCookie(HEADER_MONEY_CACHE_SCOPE, stamped)
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
 * Same formatting, but negatives are rendered rather than clamped to $0. Stripe's
 * available/pending balances can never be negative, but the wallet ledger balance can — a
 * dispute landing after a payout is a real deficit, and showing "$0" there would hide it.
 */
export function formatSignedHeaderMoneyCents(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0
  return (safe / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: safe % 100 === 0 ? 0 : 2,
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

