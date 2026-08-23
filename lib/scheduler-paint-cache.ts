/**
 * Tiny Scheduler paint cookie — hard refresh SSR can skip the empty-board flash.
 * Full bootstrap lives in sessionStorage; this only mirrors “we have a board” chrome.
 */

import {
  clearPaintSeedCookie,
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { isWorkspaceOrgStubId } from "@/lib/workspace-organizations"

export const SCHEDULER_PAINT_SCOPE = "scheduler-board"
export const SCHEDULER_PAINT_COOKIE = paintSeedCookieName(SCHEDULER_PAINT_SCOPE)

export type SchedulerPaintSeed = {
  organizationId: string | null
  /** YYYY-MM of the cached month */
  monthKey: string
  eventCount: number
  techCount: number
  fetchedAt: number
}

/**
 * fetchedAt was stamped on every write but never checked on read — dead code, and it let a
 * tech/event count from long enough ago that the roster has since genuinely changed keep
 * claiming "this month had a board" indefinitely. Generous window (unlike the fast-moving
 * KPI caches) since this seed's real job is surviving across sessions for hard-refresh SSR.
 */
const SCHEDULER_SEED_FRESH_MS = 24 * 60 * 60 * 1000

function isSchedulerSeedFresh(seed: SchedulerPaintSeed, now: number): boolean {
  if (typeof seed.fetchedAt !== "number") return false
  return now - seed.fetchedAt <= SCHEDULER_SEED_FRESH_MS
}

function orgOk(
  seedOrg: string | null | undefined,
  activeOrg: string | null | undefined
): boolean {
  const a = seedOrg ?? null
  const b = activeOrg ?? null
  if (a == null && b == null) return true
  if (a == null || b == null) return true
  if (isWorkspaceOrgStubId(a) || isWorkspaceOrgStubId(b)) return true
  return a === b
}

/** After bootstrap fetch — next hard refresh skips the blank scheduler shell. */
export function writeSchedulerPaintSeed(
  monthKey: string,
  eventCount: number,
  techCount: number,
  organizationId: string | null = null
): void {
  const payload: SchedulerPaintSeed = {
    organizationId,
    monthKey: String(monthKey || "").slice(0, 7),
    eventCount: Math.max(0, Math.min(999, eventCount | 0)),
    techCount: Math.max(0, Math.min(99, techCount | 0)),
    fetchedAt: Date.now(),
  }
  writePaintSeedCookie(SCHEDULER_PAINT_SCOPE, payload)
}

export function clearSchedulerPaintSeed(): void {
  clearPaintSeedCookie(SCHEDULER_PAINT_SCOPE)
}

export function readSchedulerPaintSeed(
  organizationId?: string | null
): SchedulerPaintSeed | null {
  const parsed = readPaintSeedCookie<SchedulerPaintSeed>(SCHEDULER_PAINT_SCOPE)
  if (!parsed || typeof parsed.monthKey !== "string") return null
  if (!isSchedulerSeedFresh(parsed, Date.now())) return null
  if (organizationId !== undefined && !orgOk(parsed.organizationId, organizationId)) {
    return null
  }
  return parsed
}

export function readSchedulerPaintFromCookieRaw(
  cookieRaw: string | null | undefined
): SchedulerPaintSeed | null {
  const parsed = readPaintSeedCookieValue<SchedulerPaintSeed>(cookieRaw)
  if (!parsed || typeof parsed.monthKey !== "string") return null
  if (!isSchedulerSeedFresh(parsed, Date.now())) return null
  return parsed
}

/** True when SSR/client paint says this month already had a board. */
export function schedulerPaintCoversMonth(
  seed: SchedulerPaintSeed | null | undefined,
  monthKey: string,
  organizationId?: string | null
): boolean {
  if (!seed) return false
  if (organizationId !== undefined && !orgOk(seed.organizationId, organizationId)) {
    return false
  }
  return seed.monthKey === monthKey
}
