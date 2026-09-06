"use server"

// Real-time call session events for the receptionist HUD.
// Broadcast the moment a receptionist's cell phone answers so their browser/mobile
// HUD instantly swaps the idle dashboard for the live intake form.

import { publishReceptionistEvent } from "@/lib/realtime/pusher-server"
import type { ReceptionistBusinessType } from "@/lib/business-type"

export type CallRingingPayload = {
  status: "ringing"
  callLogId: string
  businessType: ReceptionistBusinessType
  callerNumber?: string | null
  callerName?: string | null
  businessName?: string | null
  startedAt: string
}

/**
 * Notify a receptionist's channel that a call is routing to her, before her phone has
 * even started ringing (fired the instant the dial plan resolves, ahead of the caller
 * greeting and the outbound Dial). Fires `call-ringing` on `receptionist-{receptionistId}`.
 * Safe no-op when realtime is not configured (the HUD still catches up on its next poll).
 */
export async function handleCallRinging(params: {
  receptionistId: string
  callLogId: string
  businessType: ReceptionistBusinessType
  callerNumber?: string | null
  callerName?: string | null
  businessName?: string | null
}): Promise<{ broadcast: boolean }> {
  const receptionistId = params.receptionistId?.trim()
  if (!receptionistId) return { broadcast: false }

  const payload: CallRingingPayload = {
    status: "ringing",
    callLogId: params.callLogId,
    businessType: params.businessType,
    callerNumber: params.callerNumber ?? null,
    callerName: params.callerName ?? null,
    businessName: params.businessName ?? null,
    startedAt: new Date().toISOString(),
  }

  const broadcast = await publishReceptionistEvent(receptionistId, "call-ringing", payload)
  return { broadcast }
}

export type CallConnectedPayload = {
  status: "active_call"
  callLogId: string
  businessType: ReceptionistBusinessType
  callerNumber?: string | null
  callerName?: string | null
  businessName?: string | null
  startedAt: string
}

/**
 * Notify a receptionist's channel that a live call just connected to their phone.
 * Fires `call-connected` on `receptionist-{receptionistId}`. Safe no-op when realtime
 * is not configured (the HUD still catches up on its next poll).
 */
export async function handleCallConnected(params: {
  receptionistId: string
  callLogId: string
  businessType: ReceptionistBusinessType
  callerNumber?: string | null
  callerName?: string | null
  businessName?: string | null
}): Promise<{ broadcast: boolean }> {
  const receptionistId = params.receptionistId?.trim()
  if (!receptionistId) return { broadcast: false }

  const payload: CallConnectedPayload = {
    status: "active_call",
    callLogId: params.callLogId,
    businessType: params.businessType,
    callerNumber: params.callerNumber ?? null,
    callerName: params.callerName ?? null,
    businessName: params.businessName ?? null,
    startedAt: new Date().toISOString(),
  }

  const broadcast = await publishReceptionistEvent(receptionistId, "call-connected", payload)
  return { broadcast }
}

/** Notify a receptionist's channel that the live call ended (return HUD to idle). */
export async function handleCallEnded(params: {
  receptionistId: string
  callLogId: string
}): Promise<{ broadcast: boolean }> {
  const receptionistId = params.receptionistId?.trim()
  if (!receptionistId) return { broadcast: false }
  const broadcast = await publishReceptionistEvent(receptionistId, "call-ended", {
    status: "idle",
    callLogId: params.callLogId,
  })
  return { broadcast }
}
