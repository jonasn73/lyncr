// Text a receptionist or field tech when the owner records that their commission was paid
// outside the app (cash, Venmo, check, payroll). Mirrors lib/tech-job-assigned-sms.ts's
// internal-staff style — terse, labeled lines, not the warm customer-facing copy in
// lib/sms-status-templates.ts.

import {
  getFieldTechnicianByIdForOwner,
  getReceptionist,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import type { WorkerPayoutMethod } from "@/lib/compensation/ledger"
import type { WorkerRef } from "@/lib/compensation/plan-schema"

const METHOD_LABEL: Record<WorkerPayoutMethod, string> = {
  CASH: "Cash",
  VENMO: "Venmo",
  ZELLE: "Zelle",
  CHECK: "Check",
  PAYROLL: "Payroll",
  OTHER: "Other",
}

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })
}

export function buildWorkerPayoutSms(
  amountCents: number,
  method: WorkerPayoutMethod,
  note: string | null
): string {
  const lines = [
    `\u{1F4B5} PAYOUT RECORDED: ${formatUsd(Math.abs(amountCents))}`,
    `Method: ${METHOD_LABEL[method] ?? "Other"}`,
  ]
  const trimmedNote = note?.trim()
  if (trimmedNote) lines.push(`Note: ${trimmedNote}`)
  return lines.join("\n")
}

/** Safe no-op when the worker has no phone on file. Never throws. */
export async function sendWorkerPayoutSms(params: {
  ownerUserId: string
  ref: WorkerRef
  amountCents: number
  method: WorkerPayoutMethod
  note?: string | null
}): Promise<{ ok: true; to: string } | { ok: false; reason: string }> {
  try {
    const phone =
      params.ref.role === "receptionist"
        ? (await getReceptionist(params.ref.receptionist_id))?.phone
        : (await getFieldTechnicianByIdForOwner(params.ownerUserId, params.ref.field_technician_id))?.phone

    const toE164 = phone ? normalizePhoneNumberE164(phone) : ""
    if (!isReasonablePstnDialString(toE164)) {
      return { ok: false, reason: "no-worker-phone" }
    }

    const text = buildWorkerPayoutSms(params.amountCents, params.method, params.note ?? null)
    const sent = await sendTelnyxSms({ toE164, text, userId: params.ownerUserId })
    if (!sent.ok) {
      console.warn("[worker-payout-sms] send failed:", sent.error)
      return { ok: false, reason: sent.error }
    }
    return { ok: true, to: toE164 }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error("[worker-payout-sms] unexpected failure:", detail)
    return { ok: false, reason: detail }
  }
}
