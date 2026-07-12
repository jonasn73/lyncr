// Lightweight cross-hook bus so LyncEngine can drive RealTimeStats without a second Pusher sub.

import type {
  OwnerCallAnsweredPayload,
  OwnerCallCompletedPayload,
  OwnerCallInitiatedPayload,
} from "@/lib/realtime/owner-call-event-types"

export type LyncEngineBusEvent =
  | { type: "call-initiated"; payload: OwnerCallInitiatedPayload }
  | { type: "call-answered"; payload: OwnerCallAnsweredPayload }
  | { type: "call-completed"; payload: OwnerCallCompletedPayload }
  | { type: "engine-mounted" }
  | { type: "engine-unmounted" }

type Listener = (event: LyncEngineBusEvent) => void

const listeners = new Set<Listener>()

/** True while LyncEngineProvider owns the owner-channel Pusher subscription. */
let engineOwnsRealtime = false

export function isLyncEngineOwningRealtime(): boolean {
  return engineOwnsRealtime
}

export function setLyncEngineOwningRealtime(owns: boolean): void {
  engineOwnsRealtime = owns
  emitLyncEngineBus(owns ? { type: "engine-mounted" } : { type: "engine-unmounted" })
}

export function emitLyncEngineBus(event: LyncEngineBusEvent): void {
  listeners.forEach((listener) => {
    try {
      listener(event)
    } catch (err) {
      console.warn("[lync-engine-bus] listener error", err)
    }
  })
}

export function subscribeLyncEngineBus(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Window event — Activities list should bypass cache and refetch. */
export const LYNCR_ACTIVITY_REFRESH_EVENT = "lyncr-activity-refresh"

/** Window event — CallAnsweredModal should (re)open intake for this call. */
export const LYNCR_FOCUS_INTAKE_EVENT = "lyncr-engine-focus-intake"

export type LyncFocusIntakeDetail = {
  callSid: string
  callLogId: string | null
  fromNumber: string
  toNumber: string
  phase: "ringing" | "connected"
  answeredAt: string | null
}
