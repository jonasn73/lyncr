/**
 * Latest (Lines) session + paint-cookie cache — shared by hook + server layout.
 */

import {
  isFreshLatestPaintItem,
  isHotLatestAction,
  type LatestCustomerAction,
} from "@/lib/latest-customer-actions"
import {
  excludeReadRepliesFromLatest,
} from "@/lib/latest-seen"
import {
  readLatestSeenPaintCookie,
  readLatestSeenPaintFromCookieRaw,
  type LatestSeenPaint,
} from "@/lib/latest-seen-paint"
import {
  paintSeedCookieName,
  readPaintSeedCookie,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

const OWNER_LATEST_COOKIE_SCOPE = "owner-latest"
export const OWNER_LATEST_COOKIE = paintSeedCookieName(OWNER_LATEST_COOKIE_SCOPE)

type LatestCache = { items: LatestCustomerAction[] }

type LatestPaintCookie = {
  organizationId: string | null
  items: LatestCustomerAction[]
}

/** Optional SSR paint seed from DashboardPaintSeedsProvider. */
export type LatestPaintSeed = {
  items: LatestCustomerAction[] | null
  organizationId: string | null
}

function orgCacheId(organizationId: string | null | undefined): string {
  return organizationId && !organizationId.startsWith("legacy-") ? organizationId : "default"
}

function cacheKey(organizationId: string | null | undefined): string {
  return persistedCacheKey("owner-latest", orgCacheId(organizationId))
}

/**
 * Hot-only + age caps + Clear/open filter — same list SSR and client should paint.
 */
export function sanitizeLatestItems(
  items: unknown,
  seenPaint?: LatestSeenPaint | null,
  nowMs = Date.now()
): LatestCustomerAction[] {
  if (!Array.isArray(items)) return []
  const hot = items.filter(isHotLatestAction).filter((row) => isFreshLatestPaintItem(row, nowMs))
  return excludeReadRepliesFromLatest(hot, seenPaint ?? null)
}

export const EMPTY_LATEST: LatestCustomerAction[] = []

/**
 * True when session, paint, or document cookie already recorded Latest for this org
 * (including an empty list) — so UI can skip the Loading spinner flash.
 */
export function hasLatestSeed(
  organizationId: string | null | undefined,
  paint?: LatestPaintSeed | null
): boolean {
  const want = orgCacheId(organizationId)
  const cached = readPersistedCache<LatestCache>(cacheKey(organizationId))
  // Session entry exists (items may be empty after a successful empty fetch).
  if (cached && Array.isArray(cached.items)) return true

  // SSR paint cookie present for this org (including []).
  if (paint && paint.items != null && orgCacheId(paint.organizationId) === want) return true

  const fromCookie = readPaintSeedCookie<LatestPaintCookie>(OWNER_LATEST_COOKIE_SCOPE)
  if (fromCookie && Array.isArray(fromCookie.items) && orgCacheId(fromCookie.organizationId) === want) {
    return true
  }
  return false
}

/**
 * Read Latest cache. Pass `paint` from useDashboardPaintSeeds() on SSR/hydrate
 * so first paint matches warm cookies without a module singleton.
 * Prefer paint over session when both exist (React #418).
 */
export function readLatestCache(
  organizationId: string | null | undefined,
  paint?: LatestPaintSeed | null,
  seenPaint?: LatestSeenPaint | null
): LatestCustomerAction[] {
  const want = orgCacheId(organizationId)
  // Browser: merge cookie + localStorage. SSR: caller passes cookie-only seen paint.
  const seen =
    seenPaint ??
    (typeof document !== "undefined" ? readLatestSeenPaintCookie() : null)

  if (paint?.items != null && orgCacheId(paint.organizationId) === want) {
    const items = sanitizeLatestItems(paint.items, seen)
    return items.length > 0 ? items : EMPTY_LATEST
  }

  const cached = readPersistedCache<LatestCache>(cacheKey(organizationId))
  if (cached && Array.isArray(cached.items)) {
    const items = sanitizeLatestItems(cached.items, seen)
    if (items.length > 0) return items
    // Confirmed empty session write — return stable empty (do not fall through to stale cookie).
    return EMPTY_LATEST
  }

  const fromCookie = readPaintSeedCookie<LatestPaintCookie>(OWNER_LATEST_COOKIE_SCOPE)
  if (fromCookie?.items != null && orgCacheId(fromCookie.organizationId) === want) {
    const items = sanitizeLatestItems(fromCookie.items, seen)
    return items.length > 0 ? items : EMPTY_LATEST
  }
  return EMPTY_LATEST
}

/** Server layout helper — sanitize Latest cookie with the seen paint cookie. */
export function sanitizeLatestPaintCookieItems(
  items: unknown,
  seenCookieRaw: string | null | undefined,
  nowMs = Date.now()
): LatestCustomerAction[] {
  const seen = readLatestSeenPaintFromCookieRaw(seenCookieRaw)
  return sanitizeLatestItems(items, seen, nowMs)
}

export function writeLatestCache(
  organizationId: string | null | undefined,
  items: LatestCustomerAction[]
): void {
  const seen =
    typeof document !== "undefined" ? readLatestSeenPaintCookie() : null
  const sanitized = sanitizeLatestItems(items, seen)
  writePersistedCache(cacheKey(organizationId), {
    items: sanitized,
  } satisfies LatestCache)
  writePaintSeedCookie(OWNER_LATEST_COOKIE_SCOPE, {
    organizationId: organizationId && !organizationId.startsWith("legacy-") ? organizationId : null,
    items: sanitized.slice(0, 6).map((row) => ({
      id: row.id,
      customerPhone: row.customerPhone,
      customerName: row.customerName,
      event: row.event,
      kind: row.kind,
      headline: row.headline,
      statusLine: row.statusLine,
      preview: row.preview.slice(0, 80),
      at: row.at,
      deliveryLabel: row.deliveryLabel,
      reviewLinkOpened: row.reviewLinkOpened,
      reviewLinkClicks: row.reviewLinkClicks,
      lastOutbound: row.lastOutbound
        ? {
            id: row.lastOutbound.id,
            body: row.lastOutbound.body.slice(0, 80),
            status: row.lastOutbound.status,
            created_at: row.lastOutbound.created_at,
          }
        : null,
      lastInbound: row.lastInbound
        ? {
            id: row.lastInbound.id,
            body: row.lastInbound.body.slice(0, 80),
            created_at: row.lastInbound.created_at,
          }
        : null,
      completedJobId: row.completedJobId,
      paidAmountCents: row.paidAmountCents ?? null,
      thanksReviewPending: Boolean(row.thanksReviewPending),
    })),
  } satisfies LatestPaintCookie)
}
