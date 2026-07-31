/**
 * Compact Lines chrome seed (Main Line + Live status) for hard-refresh SSR.
 * Full bootstrap is too large for cookies — keep only what ActiveLineSubHeader needs.
 */

import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import type { RoutingStrategy } from "@/lib/types"
import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

export const LINES_CHROME_CACHE_SCOPE = "lines-chrome"
export const LINES_CHROME_SESSION_KEY = persistedCacheKey(LINES_CHROME_CACHE_SCOPE, "chrome")
export const LINES_CHROME_COOKIE = paintSeedCookieName(LINES_CHROME_CACHE_SCOPE)

/** One line row — trimmed for the 4KB cookie budget. */
export type LinesChromeLine = {
  number: string
  status: string
  label?: string
  organization_id?: string | null
  carrier_live?: boolean
}

export type LinesChromeCache = {
  organizationId: string | null
  activeLine: string | null
  lines: LinesChromeLine[]
  routingStrategy?: RoutingStrategy
  lineCarrierLive?: boolean
  subscriptionActive?: boolean
  /** Last-known “Who answers” label for call-flow first paint. */
  whoAnswers?: string | null
  /** Owner phone display for owner-routed lines. */
  ownerPhone?: string | null
  fallbackType?: string | null
}

/** Labels that mean “route to owner cell” — not a real receptionist name. */
const OWNER_WHO_ANSWERS_LABELS = new Set(["your phone", "you (owner)", "you"])

/** True when paint-seed whoAnswers is the owner sentinel (avoid fake receptionist + parentheses flash). */
export function isOwnerWhoAnswersLabel(label: string | null | undefined): boolean {
  // Empty → treat as unknown (caller decides); only named owner sentinels match.
  if (!label?.trim()) return false
  return OWNER_WHO_ANSWERS_LABELS.has(label.trim().toLowerCase())
}

const MAX_LINES = 8

function isValidChrome(cached: LinesChromeCache | null | undefined): cached is LinesChromeCache {
  return Boolean(cached && Array.isArray(cached.lines))
}

function trimChrome(next: LinesChromeCache): LinesChromeCache {
  return {
    organizationId: next.organizationId ?? null,
    activeLine: next.activeLine ?? null,
    lines: next.lines.slice(0, MAX_LINES).map((line) => ({
      number: line.number,
      status: line.status,
      ...(line.label ? { label: line.label } : {}),
      ...(line.organization_id != null ? { organization_id: line.organization_id } : {}),
      ...(line.carrier_live != null ? { carrier_live: line.carrier_live } : {}),
    })),
    ...(next.routingStrategy ? { routingStrategy: next.routingStrategy } : {}),
    ...(typeof next.lineCarrierLive === "boolean" ? { lineCarrierLive: next.lineCarrierLive } : {}),
    ...(typeof next.subscriptionActive === "boolean"
      ? { subscriptionActive: next.subscriptionActive }
      : {}),
    ...(next.whoAnswers != null ? { whoAnswers: next.whoAnswers } : {}),
    ...(next.ownerPhone != null ? { ownerPhone: next.ownerPhone } : {}),
    ...(next.fallbackType != null ? { fallbackType: next.fallbackType } : {}),
  }
}

/**
 * Session first, then optional SSR paint seed, then document cookie.
 * Pass `paint` from useDashboardPaintSeeds().lines during render/SSR.
 */
export function readLinesChromeCache(paint?: LinesChromeCache | null): LinesChromeCache | null {
  const fromSession = readPersistedCache<LinesChromeCache>(LINES_CHROME_SESSION_KEY)
  if (isValidChrome(fromSession) && fromSession.lines.length > 0) return fromSession

  if (isValidChrome(paint) && paint.lines.length > 0) return paint

  const fromCookie = readPaintSeedCookie<LinesChromeCache>(LINES_CHROME_CACHE_SCOPE)
  if (!isValidChrome(fromCookie) || fromCookie.lines.length === 0) return null
  return fromCookie
}

/** Read lines chrome paint cookie from Next.js cookies().get(name)?.value. */
export function readLinesChromeFromCookieRaw(
  cookieRaw: string | null | undefined
): LinesChromeCache | null {
  const parsed = readPaintSeedCookieValue<LinesChromeCache>(cookieRaw)
  if (!isValidChrome(parsed) || parsed.lines.length === 0) return null
  return parsed
}

/** Persist after phone lines / active line resolve (session + cookie). */
export function writeLinesChromeCache(next: LinesChromeCache): void {
  if (!next.lines.length) return
  // Merge with prior chrome so partial writers (numbers-only) keep whoAnswers / Live flags.
  const prev = readLinesChromeCache()
  const merged: LinesChromeCache = {
    organizationId: next.organizationId ?? prev?.organizationId ?? null,
    activeLine: next.activeLine ?? prev?.activeLine ?? null,
    lines: next.lines,
    routingStrategy: next.routingStrategy ?? prev?.routingStrategy,
    lineCarrierLive:
      typeof next.lineCarrierLive === "boolean" ? next.lineCarrierLive : prev?.lineCarrierLive,
    subscriptionActive:
      typeof next.subscriptionActive === "boolean"
        ? next.subscriptionActive
        : prev?.subscriptionActive,
    whoAnswers: next.whoAnswers !== undefined ? next.whoAnswers : prev?.whoAnswers,
    ownerPhone: next.ownerPhone !== undefined ? next.ownerPhone : prev?.ownerPhone,
    fallbackType: next.fallbackType !== undefined ? next.fallbackType : prev?.fallbackType,
  }
  const payload = trimChrome(merged)
  writePersistedCache(LINES_CHROME_SESSION_KEY, payload)
  writePaintSeedCookie(LINES_CHROME_CACHE_SCOPE, payload)
}

/** Map chrome rows into DashboardBusinessNumber for workspace seed. */
export function linesChromeToBusinessNumbers(chrome: LinesChromeCache): DashboardBusinessNumber[] {
  return chrome.lines.map((line) => ({
    number: line.number,
    status: line.status,
    label: line.label,
    organization_id: line.organization_id ?? null,
    carrier_live: line.carrier_live,
  }))
}
