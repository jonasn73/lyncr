// ============================================
// Shared operator call-disposition recorder
// ============================================
// One place that turns an operator outcome (BOOKED / PENDING_TIME / PRICE_REJECTED / FAILED) into
// the exact same side-effects the web dashboard button produces:
//   1. stamp the call_logs row (call_logs.disposition)
//   2. write an ai_leads disposition record (so the owner's booking toast + Lead Salvage queue react)
//   3. broadcast a live owner event
// Used by BOTH the SMS reply parser and (via dispatchStateFor) the in-app log-job endpoint.

import {
  applyLeadDisposition,
  insertAiLead,
  setCallLogDisposition,
  type LeadDisposition,
} from "@/lib/db"
import { publishOwnerEvent, type OwnerChannelEvent } from "@/lib/realtime/pusher-server"

/** Numeric SMS reply codes → our disposition ENUM. */
export const DISPOSITION_BY_CODE: Record<string, LeadDisposition> = {
  "1": "BOOKED",
  "2": "PENDING_TIME",
  "3": "PRICE_REJECTED",
  "4": "FAILED",
}

/** Human label for confirmation copy. */
export const DISPOSITION_LABEL: Record<LeadDisposition, string> = {
  BOOKED: "Booked",
  PENDING_TIME: "Pending time",
  PRICE_REJECTED: "Price rejected",
  FAILED: "Failed",
}

/** Derived workflow flags for each outcome (mirrors the log-job endpoint). */
export function dispatchStateFor(disposition: LeadDisposition): {
  dispatch_status: string
  is_salvageable: boolean
} {
  switch (disposition) {
    case "BOOKED":
      return { dispatch_status: "pending_review", is_salvageable: false }
    case "PENDING_TIME":
      return { dispatch_status: "awaiting_time", is_salvageable: false }
    case "PRICE_REJECTED":
      return { dispatch_status: "salvage_pending", is_salvageable: true }
    case "FAILED":
      return { dispatch_status: "failed", is_salvageable: false }
  }
}

/** Pick the owner realtime event name for an outcome. */
function ownerEventFor(disposition: LeadDisposition): OwnerChannelEvent {
  if (disposition === "BOOKED") return "job-booked"
  if (disposition === "PRICE_REJECTED") return "lead-salvageable"
  return "disposition-updated"
}

/** Parse the first 1-4 digit out of an SMS reply (e.g. "3", "press 3", "3 please"). */
export function parseDispositionCode(text: string): LeadDisposition | null {
  const m = text.match(/[1-4]/)
  if (!m) return null
  return DISPOSITION_BY_CODE[m[0]] ?? null
}

/**
 * Persist an operator outcome and broadcast it to the owner — identical side-effects to the
 * in-app disposition button, so the owner dashboard reacts the same way regardless of channel.
 */
export async function recordOperatorDisposition(params: {
  userId: string
  disposition: LeadDisposition
  providerCallSid?: string | null
  callLogId?: string | null
  callerNumber?: string | null
  businessName?: string | null
  operatorName?: string | null
  receptionistId?: string | null
  summary?: string | null
  source?: string
}): Promise<{ leadId: string }> {
  const { dispatch_status, is_salvageable } = dispatchStateFor(params.disposition)
  const summary =
    params.summary?.trim() ||
    `Call outcome: ${DISPOSITION_LABEL[params.disposition]}${
      params.operatorName ? ` (logged by ${params.operatorName})` : ""
    }.`

  // 1. Stamp the call_logs row (deploy-safe until scripts/059 runs).
  const callKey = params.providerCallSid?.trim() || params.callLogId?.trim() || ""
  if (callKey) {
    await setCallLogDisposition(callKey, params.disposition).catch((e) =>
      console.error("[call-disposition] setCallLogDisposition failed:", e)
    )
  }

  // 2. Lead disposition record → drives owner booking toast + Lead Salvage queue.
  const leadId = await insertAiLead({
    user_id: params.userId,
    caller_e164: params.callerNumber ?? null,
    intent_slug: "operator_disposition",
    collected: {
      source: params.source ?? "operator_disposition",
      disposition: params.disposition,
      dispatch_status,
      is_salvageable,
      ...(params.operatorName ? { captured_by_name: params.operatorName } : {}),
      ...(params.receptionistId ? { captured_by_receptionist_id: params.receptionistId } : {}),
      ...(params.providerCallSid ? { call_log_sid: params.providerCallSid } : {}),
      ...(params.callLogId ? { call_log_id: params.callLogId } : {}),
    },
    summary,
    sms_sent: false,
    sms_error: null,
    vapi_call_id: params.providerCallSid ? `${params.providerCallSid}-disposition` : null,
  })

  await applyLeadDisposition(leadId, {
    disposition: params.disposition,
    dispatch_status,
    is_salvageable,
  }).catch((e) => console.error("[call-disposition] applyLeadDisposition failed:", e))

  // 3. Broadcast to the owner (best-effort; owner dashboard also polls).
  await publishOwnerEvent(params.userId, ownerEventFor(params.disposition), {
    leadId,
    disposition: params.disposition,
    businessName: params.businessName ?? null,
    callerNumber: params.callerNumber ?? null,
    summary,
    createdAt: new Date().toISOString(),
  }).catch((e) => console.error("[call-disposition] publishOwnerEvent failed:", e))

  return { leadId }
}
