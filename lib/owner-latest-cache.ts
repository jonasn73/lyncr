/**
 * Latest (Lines) session + paint-cookie cache — shared by hook + server layout.
 */

import {
  isHotLatestAction,
  type LatestCustomerAction,
} from "@/lib/latest-customer-actions"
import {
  paintSeedCookieName,
  readPaintSeedCookie,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

export const OWNER_LATEST_COOKIE_SCOPE = "owner-latest"
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

function sanitizeItems(items: unknown): LatestCustomerAction[] {
  if (!Array.isArray(items)) return []
  return items.filter(isHotLatestAction)
}

export const EMPTY_LATEST: LatestCustomerAction[] = []

/**
 * Read Latest cache. Pass `paint` from useDashboardPaintSeeds() on SSR/hydrate
 * so first paint matches warm cookies without a module singleton.
 */
export function readLatestCache(
  organizationId: string | null | undefined,
  paint?: LatestPaintSeed | null
): LatestCustomerAction[] {
  const want = orgCacheId(organizationId)
  const cached = readPersistedCache<LatestCache>(cacheKey(organizationId))
  if (cached && Array.isArray(cached.items)) {
    const items = sanitizeItems(cached.items)
    if (items.length > 0) return items
  }

  if (paint?.items && orgCacheId(paint.organizationId) === want) {
    const items = sanitizeItems(paint.items)
    if (items.length > 0) return items
  }

  const fromCookie = readPaintSeedCookie<LatestPaintCookie>(OWNER_LATEST_COOKIE_SCOPE)
  if (fromCookie?.items && orgCacheId(fromCookie.organizationId) === want) {
    const items = sanitizeItems(fromCookie.items)
    if (items.length > 0) return items
  }
  return EMPTY_LATEST
}

export function writeLatestCache(
  organizationId: string | null | undefined,
  items: LatestCustomerAction[]
): void {
  const sanitized = sanitizeItems(items)
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
    })),
  } satisfies LatestPaintCookie)
}
