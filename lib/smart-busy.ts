// Smart Busy — capacity-aware Busy recommendation / auto-engage on Lines.
// Reuses existing presence Busy routing (ON_JOB); does not invent new TeXML.

import { SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD } from "@/lib/smart-overflow-autopilot"
import {
  isBusyPresenceStatus,
  type PresenceStatus,
} from "@/lib/account-presence"

/** Confirmed calendar jobs today + open hopper pool size. */
export function computeCapacityLoad(params: {
  confirmedJobsToday: number
  poolCount: number
}): number {
  const confirmed = Math.max(0, Math.floor(params.confirmedJobsToday) || 0)
  const pool = Math.max(0, Math.floor(params.poolCount) || 0)
  return confirmed + pool
}

/** True when load exceeds the account capacity threshold. */
export function isAtCapacity(capacityLoad: number, threshold: number): boolean {
  const t =
    Number.isFinite(threshold) && threshold >= 1
      ? Math.floor(threshold)
      : SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD
  return capacityLoad > t
}

/** Show “Calendar full — Busy recommended” when Available and over capacity. */
export function shouldRecommendBusy(params: {
  atCapacity: boolean
  presenceStatus: PresenceStatus | string | null | undefined
}): boolean {
  if (!params.atCapacity) return false
  return !isBusyPresenceStatus(params.presenceStatus)
}

/**
 * Auto-engage Busy when Smart Busy is on, day is full, and owner is Available.
 * Never overrides an already-Busy / Closed presence.
 * Respects owner suppress after they tapped Available while still full.
 */
export function shouldAutoEngageBusy(params: {
  smartBusyEnabled: boolean
  atCapacity: boolean
  presenceStatus: PresenceStatus | string | null | undefined
  suppressed?: boolean
}): boolean {
  if (!params.smartBusyEnabled || !params.atCapacity) return false
  if (params.suppressed === true) return false
  return !isBusyPresenceStatus(params.presenceStatus)
}

/**
 * Auto-revert to Available when Smart Busy had engaged Busy and capacity clears.
 * Requires an explicit “we engaged it” flag so manual Busy is never cleared.
 */
export function shouldAutoRevertBusy(params: {
  smartBusyEnabled: boolean
  atCapacity: boolean
  presenceStatus: PresenceStatus | string | null | undefined
  smartBusyEngaged: boolean
}): boolean {
  if (!params.smartBusyEnabled || !params.smartBusyEngaged) return false
  if (params.atCapacity) return false
  return isBusyPresenceStatus(params.presenceStatus)
}

/** Human summary for banners / toasts. */
export function formatSmartBusyCapacitySummary(params: {
  confirmedJobsToday: number
  poolCount: number
  capacityThreshold: number
}): string {
  const load = computeCapacityLoad(params)
  return `${load} jobs (today ${params.confirmedJobsToday} + pool ${params.poolCount}) · limit ${params.capacityThreshold}`
}

export const SMART_BUSY_STORAGE_KEY = "lyncr.smartBusy.v1"

export type SmartBusyLocalState = {
  enabled: boolean
  /** True after Smart Busy auto-set Busy (not a manual Busy tap). */
  engaged: boolean
  /**
   * When true, do not auto-engage again until capacity clears
   * (owner tapped Available while still full).
   */
  suppressed: boolean
}

/** Stable empty seed — never allocate a new `{}` per read (useClientSnapshot / #185). */
export const SMART_BUSY_EMPTY_LOCAL: SmartBusyLocalState = {
  enabled: false,
  engaged: false,
  suppressed: false,
}

export function readSmartBusyLocalState(): SmartBusyLocalState {
  if (typeof window === "undefined") {
    return SMART_BUSY_EMPTY_LOCAL
  }
  try {
    const raw = window.localStorage.getItem(SMART_BUSY_STORAGE_KEY)
    if (!raw) return SMART_BUSY_EMPTY_LOCAL
    const parsed = JSON.parse(raw) as Partial<SmartBusyLocalState>
    const enabled = parsed.enabled === true
    const engaged = parsed.engaged === true
    const suppressed = parsed.suppressed === true
    if (!enabled && !engaged && !suppressed) return SMART_BUSY_EMPTY_LOCAL
    return { enabled, engaged, suppressed }
  } catch {
    return SMART_BUSY_EMPTY_LOCAL
  }
}

export function writeSmartBusyLocalState(state: SmartBusyLocalState): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(SMART_BUSY_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore quota / private mode */
  }
}
