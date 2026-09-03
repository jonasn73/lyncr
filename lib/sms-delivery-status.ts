// Map Telnyx messaging webhook events → sms_messages delivery status.

import { updateSmsMessageDeliveryByTelnyxId } from "@/lib/db"

export type TelnyxDeliveryWebhook = {
  data?: {
    event_type?: string
    id?: string
    payload?: {
      id?: string
      to?: Array<{ phone_number?: string; status?: string }> | { phone_number?: string; status?: string }
      errors?: Array<{ code?: string | number; title?: string; detail?: string }>
    }
  }
}

function extractMessageId(body: TelnyxDeliveryWebhook): string {
  return body.data?.payload?.id?.trim() || body.data?.id?.trim() || ""
}

function extractToStatuses(payload: TelnyxDeliveryWebhook["data"]): string[] {
  const to = payload?.payload?.to
  if (Array.isArray(to)) {
    return to.map((t) => String(t?.status ?? "").trim().toLowerCase()).filter(Boolean)
  }
  if (to && typeof to === "object" && "status" in to) {
    const s = String((to as { status?: string }).status ?? "")
      .trim()
      .toLowerCase()
    return s ? [s] : []
  }
  return []
}

function extractError(payload: TelnyxDeliveryWebhook["data"]): string | null {
  const errs = payload?.payload?.errors
  if (!Array.isArray(errs) || errs.length === 0) return null
  const first = errs[0]
  const parts = [first?.title, first?.detail, first?.code != null ? String(first.code) : ""]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
  return parts.join(" — ") || null
}

/**
 * Handle Telnyx delivery lifecycle events (not inbound).
 * Returns true when an sms_messages row was updated.
 */
export async function processTelnyxSmsDeliveryEvent(body: TelnyxDeliveryWebhook): Promise<boolean> {
  const event = String(body.data?.event_type ?? "").trim()
  const messageId = extractMessageId(body)
  if (!messageId) return false

  if (event === "message.sent") {
    return updateSmsMessageDeliveryByTelnyxId({ telnyxMessageId: messageId, status: "sent" })
  }

  if (event === "message.failed") {
    return updateSmsMessageDeliveryByTelnyxId({
      telnyxMessageId: messageId,
      status: "failed",
      deliveryError: extractError(body.data) || "Message failed",
    })
  }

  if (event === "message.finalized") {
    const statuses = extractToStatuses(body.data)
    if (statuses.some((s) => s === "delivered")) {
      return updateSmsMessageDeliveryByTelnyxId({ telnyxMessageId: messageId, status: "delivered" })
    }
    if (
      statuses.some(
        (s) =>
          s === "delivery_failed" ||
          s === "delivery_unconfirmed" ||
          s.includes("fail") ||
          s === "sending_failed"
      )
    ) {
      return updateSmsMessageDeliveryByTelnyxId({
        telnyxMessageId: messageId,
        status: "failed",
        deliveryError: extractError(body.data) || statuses.join(", ") || "Delivery failed",
      })
    }
    // Finalized without a clear delivered/failed — keep as sent if we know it left Telnyx.
    if (statuses.some((s) => s === "sent" || s === "sending")) {
      return updateSmsMessageDeliveryByTelnyxId({ telnyxMessageId: messageId, status: "sent" })
    }
  }

  return false
}
