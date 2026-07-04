// AI-assisted recovery SMS for lost leads + Telnyx send with 10DLC failure handling.

import type { LostLeadRow } from "@/lib/lost-leads"
import {
  markLostLeadFailed10Dlc,
  markLostLeadRecoverySms,
} from "@/lib/lost-leads"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"
import {
  classifyTelnyxSmsError,
  sendTelnyxSms,
  type TelnyxSmsErrorType,
} from "@/lib/telnyx-sms"

function formatPrice(cents: number | null): string {
  if (cents == null || cents <= 0) return "a competitive rate"
  return `$${Math.round(cents / 100)}`
}

function vehicleLabel(row: LostLeadRow): string {
  const parts = [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean)
  return parts.length ? parts.join(" ") : "your vehicle"
}

/** Deterministic fallback when OPENAI_API_KEY is not configured. */
export function buildLostLeadRecoverySmsTemplate(row: LostLeadRow): string {
  const price = formatPrice(row.last_quoted_price_cents)
  const vehicle = vehicleLabel(row)
  const service = row.service_type?.trim() || "locksmith service"
  return (
    `Hi — sorry we missed you on ${service} for ${vehicle}. ` +
    `We can still help today starting around ${price}. Reply YES for a quick callback or call us back anytime.`
  ).slice(0, 320)
}

/** Optional OpenAI personalization; returns template on any failure. */
export async function generateLostLeadRecoverySms(row: LostLeadRow): Promise<string> {
  const template = buildLostLeadRecoverySmsTemplate(row)
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return template

  const prompt = [
    "Write one short SMS (max 300 chars) to win back a locksmith customer who declined price or hung up.",
    "Tone: friendly, local business, no emojis, include a soft discount or callback offer.",
    `Quoted price: ${formatPrice(row.last_quoted_price_cents)}`,
    `Service: ${row.service_type ?? "locksmith"}`,
    `Vehicle: ${vehicleLabel(row)}`,
    `Failure reason: ${row.failure_reason}`,
  ].join("\n")

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 120,
        messages: [
          { role: "system", content: "You write concise US SMS for a mobile locksmith." },
          { role: "user", content: prompt },
        ],
      }),
    })
    if (!res.ok) return template
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const text = json.choices?.[0]?.message?.content?.trim()
    if (!text) return template
    return text.slice(0, 320)
  } catch {
    return template
  }
}

export type LostLeadRecoverySendResult =
  | { ok: true; body: string; message_id: string | null }
  | {
      ok: false
      body: string
      error: string
      errorType: TelnyxSmsErrorType
      failed10Dlc: boolean
    }

/** Send recovery SMS; on 10DLC block marks row failed_10dlc and alerts owner channel. */
export async function sendLostLeadRecoverySms(row: LostLeadRow): Promise<LostLeadRecoverySendResult> {
  const body = await generateLostLeadRecoverySms(row)

  let result: Awaited<ReturnType<typeof sendTelnyxSms>>
  try {
    result = await sendTelnyxSms({
      toE164: row.phone_number,
      text: body,
      userId: row.user_id,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Telnyx SMS send failed"
    const classified = classifyTelnyxSmsError(message)
    if (classified.errorType === "10DLC_BLOCK") {
      await markLostLeadFailed10Dlc({ id: row.id, body, error: classified.message })
      await publishOwnerSalvageRecoveryBlocked(row, classified.message, body)
      return {
        ok: false,
        body,
        error: classified.message,
        errorType: "10DLC_BLOCK",
        failed10Dlc: true,
      }
    }
    await markLostLeadRecoverySms({ id: row.id, body, error: message, status: "lost_lead" })
    return {
      ok: false,
      body,
      error: classified.message,
      errorType: classified.errorType,
      failed10Dlc: false,
    }
  }

  if (result.ok) {
    await markLostLeadRecoverySms({ id: row.id, body, error: null, status: "recovery_sent" })
    return { ok: true, body, message_id: result.message_id }
  }

  const classified = classifyTelnyxSmsError(result.error)

  if (classified.errorType === "10DLC_BLOCK") {
    await markLostLeadFailed10Dlc({ id: row.id, body, error: classified.message })
    await publishOwnerSalvageRecoveryBlocked(row, classified.message, body)
    return {
      ok: false,
      body,
      error: classified.message,
      errorType: "10DLC_BLOCK",
      failed10Dlc: true,
    }
  }

  await markLostLeadRecoverySms({
    id: row.id,
    body,
    error: classified.message,
    status: "lost_lead",
  })

  return {
    ok: false,
    body,
    error: classified.message,
    errorType: classified.errorType,
    failed10Dlc: false,
  }
}

async function publishOwnerSalvageRecoveryBlocked(
  row: LostLeadRow,
  errorMessage: string,
  attemptedBody: string
): Promise<void> {
  await publishOwnerEvent(row.user_id, "salvage-recovery-blocked", {
    lost_lead_id: row.id,
    phone_number: row.phone_number,
    failure_reason: row.failure_reason,
    last_quoted_price_cents: row.last_quoted_price_cents,
    status: "failed_10dlc",
    error: errorMessage,
    manual_retry_required: true,
    attempted_sms_preview: attemptedBody.slice(0, 120),
    message:
      "Recovery SMS blocked by carrier (10DLC). Call this lead back manually or send from an approved channel.",
  }).catch((e) => console.warn("[lost-lead-recovery-sms] salvage-recovery-blocked publish failed:", e))

  await publishOwnerEvent(row.user_id, "lead-salvageable", {
    leadId: row.id,
    source: "lost_lead",
    reason: row.failure_reason,
    status: "failed_10dlc",
    manual_retry_required: true,
  }).catch(() => {})
}
