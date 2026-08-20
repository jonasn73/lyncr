/**
 * Compact Lines chrome seed (Main Line + Live status) for hard-refresh SSR.
 * Full bootstrap is too large for cookies — keep only what ActiveLineSubHeader needs.
 */

import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { businessNumbersMatch } from "@/lib/dashboard-routing-utils"
import type { RoutingStrategy } from "@/lib/types"
import { customerFacingPhoneLines, isAmberControlLine } from "@/lib/amber-control-line"
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
  /** Amber helper DID — filtered out of Lines UI even when still in the cookie. */
  is_amber_control?: boolean
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
      ...(line.is_amber_control === true ? { is_amber_control: true } : {}),
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
 * Paint seed first (SSR HTML), then session, then document cookie.
 * Pass `paint` from useDashboardPaintSeeds().lines during render/SSR.
 *
 * Prefer paint over session when both exist so hard-refresh HTML matches hydrate
 * (React #418). Session still fills gaps when the cookie seed is empty — only safe
 * inside useState / useSessionSeed (initializer does not re-run on hydrate).
 * Do not call this every render for UI branching; use `paintSeeds.lines` instead.
 */
export function readLinesChromeCache(paint?: LinesChromeCache | null): LinesChromeCache | null {
  if (isValidChrome(paint) && paint.lines.length > 0) return paint

  const fromSession = readPersistedCache<LinesChromeCache>(LINES_CHROME_SESSION_KEY)
  if (isValidChrome(fromSession) && fromSession.lines.length > 0) return fromSession

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
  // Never paint Amber as a shop line — keep Lines refresh on Business Line.
  const shopLines = customerFacingPhoneLines(next.lines)
  if (!shopLines.length) return
  const prev = readLinesChromeCache()
  let activeLine = next.activeLine ?? prev?.activeLine ?? null
  const activeIsAmber = isAmberControlLine(
    next.lines.find((l) => businessNumbersMatch(l.number, activeLine)) ??
      prev?.lines.find((l) => businessNumbersMatch(l.number, activeLine))
  )
  const activeStillShop = shopLines.some((l) => businessNumbersMatch(l.number, activeLine))
  if (!activeLine || activeIsAmber || !activeStillShop) {
    // Prefer the first shop line when Amber (or a missing DID) was selected.
    activeLine = shopLines[0]?.number ?? null
  }
  const merged: LinesChromeCache = {
    organizationId: next.organizationId ?? prev?.organizationId ?? null,
    activeLine,
    lines: shopLines,
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
  return customerFacingPhoneLines(chrome.lines).map((line) => ({
    number: line.number,
    status: line.status,
    label: line.label,
    organization_id: line.organization_id ?? null,
    carrier_live: line.carrier_live,
    is_amber_control: line.is_amber_control === true,
  }))
}
