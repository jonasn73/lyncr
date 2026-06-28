// Server-side Pusher publisher for receptionist real-time events.
// No-ops gracefully when Pusher env vars are not set, so the app keeps working
// (the receptionist HUD falls back to its 15s polling refresh).

import Pusher from "pusher"

let cached: Pusher | null = null
let resolved = false

/** Lazily build the Pusher server client; returns null when not configured. */
function getPusherServer(): Pusher | null {
  if (resolved) return cached
  resolved = true
  const appId = process.env.PUSHER_APP_ID?.trim()
  const key = process.env.PUSHER_KEY?.trim()
  const secret = process.env.PUSHER_SECRET?.trim()
  const cluster = process.env.PUSHER_CLUSTER?.trim() || "us2"
  if (!appId || !key || !secret) {
    cached = null
    return null
  }
  cached = new Pusher({ appId, key, secret, cluster, useTLS: true })
  return cached
}

/** True when realtime is configured on the server. */
export function isRealtimeConfigured(): boolean {
  return getPusherServer() !== null
}

export type ReceptionistChannelEvent =
  | "call-connected"
  | "call-ended"

/** Publish an event to a single receptionist's private-ish channel. Safe no-op when unconfigured. */
export async function publishReceptionistEvent(
  receptionistId: string,
  event: ReceptionistChannelEvent,
  payload: Record<string, unknown>
): Promise<boolean> {
  const pusher = getPusherServer()
  if (!pusher) return false
  const channel = `receptionist-${receptionistId}`
  try {
    await pusher.trigger(channel, event, payload)
    return true
  } catch (e) {
    console.error("[realtime] publishReceptionistEvent failed:", e)
    return false
  }
}

export type TechnicianChannelEvent = "job-assigned" | "job-updated"

/** Publish to a single field tech's device channel (e.g. new job dispatched). Safe no-op when unconfigured. */
export async function publishTechnicianEvent(
  techUserId: string,
  event: TechnicianChannelEvent,
  payload: Record<string, unknown>
): Promise<boolean> {
  const pusher = getPusherServer()
  if (!pusher) return false
  const channel = `technician-${techUserId}`
  try {
    await pusher.trigger(channel, event, payload)
    return true
  } catch (e) {
    console.error("[realtime] publishTechnicianEvent failed:", e)
    return false
  }
}

export type OwnerChannelEvent =
  | "job-booked"
  | "job-assigned"
  | "lead-salvageable"
  | "disposition-updated"
  | "job-status-updated"
  | "tech-location-updated"
  | "call-initiated"
  | "call-answered"
  | "call-completed"
  | "porting-update"

/** Live call HUD events — must not await Neon before trigger (intake modal latency). */
const OWNER_INBOUND_TELEMETRY: ReadonlySet<OwnerChannelEvent> = new Set([
  "call-initiated",
  "call-answered",
  "call-completed",
])

/** Publish an event to a business owner's channel (e.g. live booking alerts). Safe no-op when unconfigured. */
export async function publishOwnerEvent(
  ownerId: string,
  event: OwnerChannelEvent,
  payload: Record<string, unknown>
): Promise<boolean> {
  const pusher = getPusherServer()
  if (!pusher) return false
  const channel = `owner-${ownerId}`

  if (OWNER_INBOUND_TELEMETRY.has(event)) {
    try {
      await pusher.trigger(channel, event, payload)
      return true
    } catch (e) {
      console.error("[realtime] publishOwnerEvent failed:", e)
      return false
    }
  }

  const { prepareOwnerEventForDelivery } = await import("@/lib/admin-notification-dispatch")
  const prepared = await prepareOwnerEventForDelivery(ownerId, event, payload)
  if (!prepared.publish) return false
  try {
    await pusher.trigger(channel, event, prepared.payload)
    return true
  } catch (e) {
    console.error("[realtime] publishOwnerEvent failed:", e)
    return false
  }
}
