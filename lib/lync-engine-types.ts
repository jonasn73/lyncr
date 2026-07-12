// Shared types for the global Lync line-state engine.

import type { CallerContextMatch } from "@/lib/caller-context-engine"

/** Active leg phase across the owner dashboard. */
export type LyncLinePhase = "idle" | "ringing" | "connected"

/** One live inbound leg tracked by the engine. */
export type LyncEngineCall = {
  callSid: string
  callLogId: string | null
  fromNumber: string
  toNumber: string
  organizationId: string | null
  phase: "ringing" | "connected"
  answeredAt: string | null
  /** Prefetched CRM / scheduler context for the intake overlay. */
  callerContext: CallerContextMatch | null
  lookupLoading: boolean
}

export type LyncEnginePublicState = {
  /** Most recent ringing or connected leg (null when idle). */
  primaryCall: LyncEngineCall | null
  activeCalls: LyncEngineCall[]
  linePhase: LyncLinePhase
  /** Unread missed calls for the Activities dock badge. */
  activityBadgeCount: number
  realtimeConnected: boolean
  /** Clear the Activities nav badge (e.g. when visiting the tab). */
  clearActivityBadge: () => void
  /** Re-open / focus the intake sheet for the primary call. */
  focusIntake: () => void
}
