// Native mobile push notifications (missed / live calls) via Expo's push service.
// The mobile app (mobile/) registers an Expo push token per device (see
// app/api/push/register/route.ts, scripts/175-device-push-tokens.sql); Expo itself manages
// the underlying APNs/FCM delivery, so this only ever talks to Expo's one HTTP API — no
// provider SDKs or credentials to manage here.

import { getDevicePushTokensForUser } from "@/lib/db"

const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send"

type PushMessage = {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  sound?: "default"
}

async function sendExpoPush(messages: PushMessage[]): Promise<void> {
  if (messages.length === 0) return
  try {
    const res = await fetch(EXPO_PUSH_API_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    })
    if (!res.ok) {
      console.warn("[push] Expo push API returned", res.status, await res.text().catch(() => ""))
    }
  } catch (e) {
    // Never let a push failure break the call-handling path that triggered it.
    console.warn("[push] Expo push send failed:", e)
  }
}

/** A customer is calling right now — skip when Busy/Hold answers first (owner's phone never rings). */
export async function notifyOwnerOfIncomingCall(params: {
  ownerUserId: string
  fromNumber: string
  dialReason?: string | null
}): Promise<void> {
  if (params.dialReason === "busy_automation") return
  const tokens = await getDevicePushTokensForUser(params.ownerUserId)
  if (tokens.length === 0) return
  await sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "Incoming call",
      body: `Call from ${params.fromNumber}`,
      data: { type: "call-initiated", fromNumber: params.fromNumber },
      sound: "default",
    }))
  )
}

/**
 * A call just ended — push only when it was actually missed. Callers already have an
 * `OwnerCallCompletedPayload` and should pass `isMissedCallTelemetry(payload)` from
 * lib/realtime/owner-call-event-types.ts as `isMissed`, so this stays the single source of
 * truth for "missed" (IVR/AI-handled, hold-answered, and sub-5s aborted-connect edge cases)
 * instead of a second, drifting definition here.
 */
export async function notifyOwnerOfCompletedCall(params: {
  ownerUserId: string
  isMissed: boolean
  fromNumber?: string | null
  callLogId?: string | null
}): Promise<void> {
  if (!params.isMissed) return
  const tokens = await getDevicePushTokensForUser(params.ownerUserId)
  if (tokens.length === 0) return
  const from = params.fromNumber?.trim() || "Unknown"
  await sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "Missed call",
      body: `Missed call from ${from}`,
      data: { type: "call-missed", fromNumber: from, callLogId: params.callLogId ?? null },
      sound: "default",
    }))
  )
}
