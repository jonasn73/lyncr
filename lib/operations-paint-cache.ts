/**
 * Compact Activity call list for hard-refresh paint cookies.
 * Must stay tiny — encodeURIComponent + cookie name must fit ~4KB or SSR paints skeleton.
 */

import {
  clearPaintSeedCookie,
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { isWorkspaceOrgStubId } from "@/lib/workspace-organizations"
import type { UiCallRecord } from "@/lib/operations-ui-types"

export const OPERATIONS_PAINT_SCOPE = "operations-calls"
export const OPERATIONS_PAINT_COOKIE = paintSeedCookieName(OPERATIONS_PAINT_SCOPE)

/** Minimal row — enough for mobile cards + desktop table first paint. */
export type OperationsPaintCall = {
  id: string
  type: UiCallRecord["type"]
  callerName: string
  callerNumber: string
  targetLineE164: string
  routedTo: string
  routedToReceptionistId: string | null
  routedInitials: string
  routedColor: string
  date: string
  time: string
  createdAt: string
  rawCallType: string
  callStatus: string
  answeredAt: string | null
  endedAt: string | null
  durationSeconds: number
  hasRecording: boolean
  recordingUrl: string | null
}

export type OperationsPaintSeed = {
  organizationId: string | null
  calls: OperationsPaintCall[]
  fetchedAt: number
}

/** Prefer more rows that still fit the cookie — empty SSR skeleton is worse than a short list. */
const MAX_PAINT_CALLS = 8

function clip(s: string, n: number): string {
  const t = String(s || "")
  return t.length > n ? t.slice(0, n) : t
}

function trimCall(c: UiCallRecord): OperationsPaintCall {
  return {
    id: clip(c.id, 36),
    type: c.type,
    callerName: clip(c.callerName, 22),
    callerNumber: clip(c.callerNumber, 16),
    targetLineE164: clip(c.targetLineE164, 14),
    routedTo: clip(c.routedTo, 28),
    routedToReceptionistId: null,
    routedInitials: clip(c.routedInitials, 2),
    routedColor: "bg-primary",
    date: clip(c.date, 10),
    time: clip(c.time, 10),
    createdAt: clip(c.createdAt, 24),
    rawCallType: clip(c.rawCallType, 12),
    callStatus: clip(c.callStatus, 20),
    // Keep real ISO — classifyCall needs parseable answeredAt (null made every row Missed).
    answeredAt: c.answeredAt ? clip(c.answeredAt, 24) : null,
    endedAt: null,
    durationSeconds: c.durationSeconds | 0,
    hasRecording: Boolean(c.hasRecording),
    recordingUrl: null,
  }
}

function isValidSeed(raw: OperationsPaintSeed | null | undefined): raw is OperationsPaintSeed {
  return Boolean(raw && Array.isArray(raw.calls))
}

export function operationsPaintMatchesOrg(
  seed: OperationsPaintSeed | null | undefined,
  organizationId: string | null | undefined
): boolean {
  if (!seed) return false
  const seedOrg = seed.organizationId ?? null
  const activeOrg = organizationId ?? null
  if (seedOrg == null && activeOrg == null) return true
  if (seedOrg == null) return true
  if (activeOrg == null) return true
  if (isWorkspaceOrgStubId(seedOrg) || isWorkspaceOrgStubId(activeOrg)) return true
  return seedOrg === activeOrg
}

export function operationsPaintToUiCalls(seed: OperationsPaintSeed): UiCallRecord[] {
  return seed.calls.map((c) => ({
    ...c,
    recordingUrl: c.recordingUrl,
    activity: null,
  }))
}

export function writeOperationsPaintSeed(
  calls: UiCallRecord[],
  fetchedAt: number,
  organizationId: string | null = null
): void {
  let n = Math.min(MAX_PAINT_CALLS, Math.max(0, calls.length))
  while (n >= 0) {
    const payload: OperationsPaintSeed = {
      organizationId,
      calls: calls.slice(0, n).map(trimCall),
      fetchedAt,
    }
    if (writePaintSeedCookie(OPERATIONS_PAINT_SCOPE, payload)) return
    n -= 1
  }
}

export function clearOperationsPaintSeed(): void {
  clearPaintSeedCookie(OPERATIONS_PAINT_SCOPE)
}

export function readOperationsPaintSeed(
  organizationId?: string | null
): OperationsPaintSeed | null {
  const parsed = readPaintSeedCookie<OperationsPaintSeed>(OPERATIONS_PAINT_SCOPE)
  if (!isValidSeed(parsed)) return null
  if (organizationId !== undefined && !operationsPaintMatchesOrg(parsed, organizationId)) {
    return null
  }
  return parsed
}

export function readOperationsPaintFromCookieRaw(
  cookieRaw: string | null | undefined
): OperationsPaintSeed | null {
  const parsed = readPaintSeedCookieValue<OperationsPaintSeed>(cookieRaw)
  if (!isValidSeed(parsed)) return null
  return parsed
}
