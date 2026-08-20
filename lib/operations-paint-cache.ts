/**
 * Compact Activity call list for hard-refresh paint cookies.
 * Full UiCallRecord JSON is too big for cookies — keep a short list of display fields.
 */

import {
  clearPaintSeedCookie,
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { isWorkspaceOrgStubId } from "@/lib/workspace-organizations"
import type { UiCallRecord } from "@/lib/hooks/use-operations-data"

export const OPERATIONS_PAINT_SCOPE = "operations-calls"
export const OPERATIONS_PAINT_COOKIE = paintSeedCookieName(OPERATIONS_PAINT_SCOPE)

/** One row — enough for Activities table first paint. */
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
  /** Active shop when this seed was written — ignore on mismatch. */
  organizationId: string | null
  calls: OperationsPaintCall[]
  fetchedAt: number
}

/** Cookie budget — a few recent rows only. */
const MAX_PAINT_CALLS = 12

function trimCall(c: UiCallRecord): OperationsPaintCall {
  // Drop activity blob — not needed for the table skeleton-avoidance paint.
  return {
    id: c.id,
    type: c.type,
    callerName: c.callerName,
    callerNumber: c.callerNumber,
    targetLineE164: c.targetLineE164,
    routedTo: c.routedTo,
    routedToReceptionistId: c.routedToReceptionistId,
    routedInitials: c.routedInitials,
    routedColor: c.routedColor,
    date: c.date,
    time: c.time,
    createdAt: c.createdAt,
    rawCallType: c.rawCallType,
    callStatus: c.callStatus,
    answeredAt: c.answeredAt,
    endedAt: c.endedAt,
    durationSeconds: c.durationSeconds,
    hasRecording: c.hasRecording,
    recordingUrl: null,
  }
}

function isValidSeed(raw: OperationsPaintSeed | null | undefined): raw is OperationsPaintSeed {
  return Boolean(raw && Array.isArray(raw.calls))
}

/** True when the paint seed belongs to the current shop (or both unknown). */
export function operationsPaintMatchesOrg(
  seed: OperationsPaintSeed | null | undefined,
  organizationId: string | null | undefined
): boolean {
  if (!seed) return false
  const seedOrg = seed.organizationId ?? null
  const activeOrg = organizationId ?? null
  // Both unknown — legacy single-shop paint.
  if (seedOrg == null && activeOrg == null) return true
  // Legacy cookie without org tag — same account; do not wipe Activity on refresh.
  if (seedOrg == null) return true
  // Active shop not resolved yet — keep tagged seed on screen.
  if (activeOrg == null) return true
  // Paint-seed stub vs real uuid is the same shop — do not wipe Activity.
  if (isWorkspaceOrgStubId(seedOrg) || isWorkspaceOrgStubId(activeOrg)) return true
  return seedOrg === activeOrg
}

/** Expand paint rows into UiCallRecord (activity null until live fetch). */
export function operationsPaintToUiCalls(seed: OperationsPaintSeed): UiCallRecord[] {
  return seed.calls.map((c) => ({
    ...c,
    recordingUrl: c.recordingUrl,
    activity: null,
  }))
}

/** Persist after a successful /api/calls load (session cookie for next hard refresh). */
export function writeOperationsPaintSeed(
  calls: UiCallRecord[],
  fetchedAt: number,
  organizationId: string | null = null
): void {
  // Empty successful load still counts as “painted” — avoids gray bars on reload.
  const payload: OperationsPaintSeed = {
    organizationId,
    calls: calls.slice(0, MAX_PAINT_CALLS).map(trimCall),
    fetchedAt,
  }
  writePaintSeedCookie(OPERATIONS_PAINT_SCOPE, payload)
}

/** Drop Activity paint cookie (logout / wrong-shop). */
export function clearOperationsPaintSeed(): void {
  clearPaintSeedCookie(OPERATIONS_PAINT_SCOPE)
}

/** Client: last Activity paint cookie (hard refresh before sessionStorage warms). */
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

/** Server: parse cookie raw from Next.js cookies().get. */
export function readOperationsPaintFromCookieRaw(
  cookieRaw: string | null | undefined
): OperationsPaintSeed | null {
  const parsed = readPaintSeedCookieValue<OperationsPaintSeed>(cookieRaw)
  if (!isValidSeed(parsed)) return null
  return parsed
}
