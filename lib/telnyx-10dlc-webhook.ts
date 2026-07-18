// Parse Telnyx 10DLC brand/campaign webhook envelopes into a stable shape.
// Docs: https://developers.telnyx.com/docs/messaging/10dlc/event-notifications
// Also accepts legacy brand.* names from brand-registration docs (brand.vetted, etc.).

import { formatTelnyxRegistryText, normalizeTelnyxRegistryStatus } from "@/lib/telnyx-10dlc"

/** Canonical Telnyx 10DLC event types we accept on /api/webhooks/telnyx. */
export const TELNYX_10DLC_WEBHOOK_EVENTS = new Set([
  "10dlc.brand.update",
  "10dlc.campaign.update",
  "10dlc.phone_number.update",
  "brand.created",
  "brand.updated",
  "brand.vetted",
  "brand.deleted",
])

/** Pull event_type from common Telnyx envelope shapes. */
export function extractTelnyx10DlcEventType(body: Record<string, unknown>): string {
  const data = body.data as Record<string, unknown> | undefined
  const candidates = [data?.event_type, body.event_type, body.eventType, data?.eventType]
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim()
  }
  return ""
}

/** True when this webhook is a 10DLC brand/campaign/phone lifecycle event. */
export function isTelnyx10DlcWebhookEvent(eventType: string): boolean {
  const lower = eventType.toLowerCase().trim()
  if (!lower) return false
  if (TELNYX_10DLC_WEBHOOK_EVENTS.has(lower)) return true
  if (lower.startsWith("10dlc.")) return true
  if (lower.startsWith("brand.")) return true
  return false
}

export type Telnyx10DlcWebhookPayload = {
  eventType: string
  eventId: string | null
  brandId: string | null
  campaignId: string | null
  payloadType: string | null
  tcrEventType: string | null
  status: string | null
  identityStatus: string | null
  failureReason: string | null
  description: string | null
  rawPayload: Record<string, unknown>
}

/** Flatten Telnyx REGISTRATION `reasons` arrays into one human-readable string. */
export function formatTelnyx10DlcFailureReasons(reasons: unknown): string | null {
  if (reasons == null) return null
  if (typeof reasons === "string") return formatTelnyxRegistryText(reasons)
  if (!Array.isArray(reasons)) return formatTelnyxRegistryText(reasons)

  const parts: string[] = []
  for (const item of reasons) {
    if (item == null) continue
    if (typeof item === "string") {
      const t = item.trim()
      if (t) parts.push(t)
      continue
    }
    if (typeof item === "object") {
      const row = item as Record<string, unknown>
      const description =
        formatTelnyxRegistryText(row.description) ||
        formatTelnyxRegistryText(row.message) ||
        formatTelnyxRegistryText(row.reason) ||
        formatTelnyxRegistryText(row.detail)
      const fields = Array.isArray(row.fields)
        ? row.fields.map((f) => String(f).trim()).filter(Boolean).join(", ")
        : ""
      if (description && fields) parts.push(`${fields}: ${description}`)
      else if (description) parts.push(description)
      else if (fields) parts.push(`Invalid ${fields}`)
    }
  }
  return parts.length > 0 ? parts.join("; ") : null
}

/** Normalize the nested `data.payload` object from a Telnyx event. */
export function extractTelnyx10DlcPayload(body: Record<string, unknown>): Record<string, unknown> {
  const data = body.data as Record<string, unknown> | undefined
  const nested = data?.payload
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>
  }
  if (body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)) {
    return body.payload as Record<string, unknown>
  }
  // brand.vetted-style payloads sometimes put fields on data itself.
  if (data && typeof data === "object") {
    return data
  }
  return body
}

/** Parse a Telnyx 10DLC webhook body into fields we can act on. */
export function parseTelnyx10DlcWebhook(body: Record<string, unknown>): Telnyx10DlcWebhookPayload {
  const eventType = extractTelnyx10DlcEventType(body)
  const data = body.data as Record<string, unknown> | undefined
  const payload = extractTelnyx10DlcPayload(body)

  const brandId =
    (typeof payload.brandId === "string" && payload.brandId.trim()) ||
    (typeof payload.brand_id === "string" && payload.brand_id.trim()) ||
    null
  const campaignId =
    (typeof payload.campaignId === "string" && payload.campaignId.trim()) ||
    (typeof payload.campaign_id === "string" && payload.campaign_id.trim()) ||
    null

  const identityStatus =
    (typeof payload.identityStatus === "string" && payload.identityStatus.trim()) ||
    (typeof payload.identity_status === "string" && payload.identity_status.trim()) ||
    null

  const statusRaw =
    (typeof payload.status === "string" && payload.status.trim()) ||
    (typeof payload.campaignStatus === "string" && payload.campaignStatus.trim()) ||
    (typeof payload.tcrCampaignStatus === "string" && payload.tcrCampaignStatus.trim()) ||
    null

  const failureReason =
    formatTelnyx10DlcFailureReasons(payload.reasons) ||
    formatTelnyxRegistryText(payload.failureReasons) ||
    formatTelnyxRegistryText(payload.failureReason) ||
    formatTelnyxRegistryText(payload.description) ||
    null

  const eventId =
    (typeof data?.id === "string" && data.id) ||
    (typeof body.id === "string" && body.id) ||
    null

  return {
    eventType,
    eventId,
    brandId,
    campaignId,
    payloadType: typeof payload.type === "string" ? payload.type.trim() : null,
    tcrEventType: typeof payload.eventType === "string" ? payload.eventType.trim() : null,
    status: statusRaw,
    identityStatus,
    failureReason,
    description: formatTelnyxRegistryText(payload.description),
    rawPayload: payload,
  }
}

export type TenDlcWebhookOutcome = "approved" | "rejected" | "pending" | "ignored"

/**
 * Decide approved / rejected / pending from identityStatus, campaign status, and payload type.
 * Prefer identityStatus for brand.vetted / brand updates; prefer campaign status for campaign events.
 */
export function resolveTenDlcWebhookOutcome(parsed: Telnyx10DlcWebhookPayload): {
  outcome: TenDlcWebhookOutcome
  statusCode: string | null
  failureReason: string | null
} {
  const identity = (parsed.identityStatus ?? "").toUpperCase().trim()
  const status = (parsed.status ?? "").toUpperCase().trim()
  const payloadType = (parsed.payloadType ?? "").toUpperCase().trim()
  const tcrEvent = (parsed.tcrEventType ?? "").toUpperCase().trim()
  const eventType = parsed.eventType.toLowerCase()

  // Explicit registration / review failures with reasons.
  if (payloadType === "REGISTRATION" && (status === "FAILED" || status === "REJECTED" || !status)) {
    if (parsed.failureReason || status === "FAILED" || status === "REJECTED") {
      return {
        outcome: "rejected",
        statusCode: status || "FAILED",
        failureReason: parsed.failureReason || "Registration failed at the carrier.",
      }
    }
  }

  if (payloadType === "TELNYX_REVIEW" || payloadType === "MNO_REVIEW") {
    if (status === "REJECTED" || status === "FAILED") {
      return {
        outcome: "rejected",
        statusCode: status,
        failureReason: parsed.failureReason || parsed.description || "Campaign rejected during review.",
      }
    }
    if (status === "ACCEPTED" || status === "APPROVED") {
      return { outcome: "approved", statusCode: status, failureReason: null }
    }
  }

  if (payloadType === "TELNYX_EVENT" && (status === "DORMANT" || status === "SUSPENDED")) {
    return {
      outcome: "rejected",
      statusCode: status,
      failureReason: parsed.failureReason || "Campaign was suspended by the carrier.",
    }
  }

  if (payloadType === "VERIFIED" || tcrEvent.includes("APPROVED") || tcrEvent.includes("UNSUSPENDED")) {
    return { outcome: "approved", statusCode: payloadType || tcrEvent || status, failureReason: null }
  }

  if (tcrEvent.includes("REJECTED") || tcrEvent.includes("SUSPENDED") || tcrEvent.includes("EXPIRED")) {
    return {
      outcome: "rejected",
      statusCode: tcrEvent || status,
      failureReason: parsed.failureReason || parsed.description || `Campaign ${tcrEvent.toLowerCase()}.`,
    }
  }

  // brand.vetted / brand.updated — identityStatus is the source of truth.
  if (identity) {
    const normalized = normalizeTelnyxRegistryStatus(identity)
    if (normalized === "approved") {
      return { outcome: "approved", statusCode: identity, failureReason: null }
    }
    if (normalized === "rejected") {
      return {
        outcome: "rejected",
        statusCode: identity,
        failureReason:
          parsed.failureReason ||
          "Brand identity could not be verified. Check EIN, legal name, and address.",
      }
    }
    if (normalized === "pending_review") {
      return { outcome: "pending", statusCode: identity, failureReason: null }
    }
  }

  if (status) {
    const normalized = normalizeTelnyxRegistryStatus(status)
    if (normalized === "approved") {
      return { outcome: "approved", statusCode: status, failureReason: null }
    }
    if (normalized === "rejected") {
      return {
        outcome: "rejected",
        statusCode: status,
        failureReason: parsed.failureReason || parsed.description || `Carrier status: ${status}.`,
      }
    }
    if (normalized === "pending_review") {
      return { outcome: "pending", statusCode: status, failureReason: null }
    }
  }

  // brand.created / brand.updated without a clear status — acknowledge only.
  if (eventType === "brand.created" || eventType === "10dlc.phone_number.update") {
    return { outcome: "ignored", statusCode: status || identity || null, failureReason: null }
  }

  return { outcome: "ignored", statusCode: status || identity || null, failureReason: parsed.failureReason }
}
