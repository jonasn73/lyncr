// Shared Telnyx porting webhook processor — used by /api/webhooks/telnyx and /porting.

import { after, NextResponse } from "next/server"
import {
  getPortingOrderByPhoneNumberForOwner,
  getPortingOrderByTelnyxOrderId,
  getPortingOrderByTelnyxOrderIdGlobal,
  insertPortingNotificationIfNew,
} from "@/lib/db"
import { SITE_NAME } from "@/lib/brand"
import { finalizePortedNumber } from "@/lib/port-number-finalize"
import {
  applyPortActionRequiredFromTelnyxWebhook,
  applyPortRejectionFromTelnyxWebhook,
  syncPortingOrderFromTelnyxWebhook,
} from "@/lib/porting-order-sync"
import {
  extractPortingCarrierRequirement,
  formatPortingExceptionSystemMessage,
} from "@/lib/porting-carrier-exceptions"
import { extractPortingStatusKeyword } from "@/lib/porting-notification-log"
import { buildPortingNotificationLogBody } from "@/lib/porting-notification-log"
import {
  buildPortingNotificationTitle,
  extractBillingTelephoneNumber,
  extractEventType,
  extractPortingPhoneNumbers,
  extractTelnyxEventId,
  findPortingOrderId,
  isTelnyxPortingWebhookEvent,
} from "@/lib/telnyx-porting-webhook"
import {
  findZingCustomerReferenceInPayload,
  parseZingCustomerReference,
} from "@/lib/telnyx-customer-reference"
import type { PortingOrder } from "@/lib/types"

export type ResolvedPortingWebhookOwner = {
  userId: string
  organizationId: string | null
  telnyxOrderId: string | null
  portingOrder: PortingOrder | null
  matchedBy: "customer_reference" | "billing_phone" | "telnyx_order_id"
}

async function resolvePortingOrderForWebhook(params: {
  ownerUserId: string
  organizationId: string | null
  telnyxOrderId: string | null
  billingPhone: string | null
}): Promise<PortingOrder | null> {
  const telnyxId = params.telnyxOrderId?.trim()
  if (telnyxId) {
    const byTelnyx = await getPortingOrderByTelnyxOrderId(params.ownerUserId, telnyxId)
    if (byTelnyx) {
      if (params.organizationId && byTelnyx.organization_id && byTelnyx.organization_id !== params.organizationId) {
        return null
      }
      return byTelnyx
    }
  }
  if (params.billingPhone) {
    return getPortingOrderByPhoneNumberForOwner(params.ownerUserId, params.billingPhone, params.organizationId)
  }
  if (telnyxId) {
    const global = await getPortingOrderByTelnyxOrderIdGlobal(telnyxId)
    if (global && global.owner_user_id === params.ownerUserId) {
      if (params.organizationId && global.organization_id && global.organization_id !== params.organizationId) {
        return null
      }
      return global
    }
  }
  return null
}

/** Resolve workspace owner + org from customer_reference, BTN, or Telnyx order id. */
export async function resolvePortingWebhookOwner(
  body: Record<string, unknown>
): Promise<ResolvedPortingWebhookOwner | null> {
  const telnyxOrderId = findPortingOrderId(body)
  const billingPhone = extractBillingTelephoneNumber(body)

  const customerRef = findZingCustomerReferenceInPayload(body)
  if (customerRef) {
    const parsed = parseZingCustomerReference(customerRef)
    if (parsed?.userId) {
      const portingOrder = await resolvePortingOrderForWebhook({
        ownerUserId: parsed.userId,
        organizationId: parsed.organizationId,
        telnyxOrderId,
        billingPhone,
      })
      return {
        userId: parsed.userId,
        organizationId: portingOrder?.organization_id ?? parsed.organizationId,
        telnyxOrderId: telnyxOrderId ?? portingOrder?.telnyx_order_id ?? null,
        portingOrder,
        matchedBy: "customer_reference",
      }
    }
  }

  if (telnyxOrderId) {
    const order = await getPortingOrderByTelnyxOrderIdGlobal(telnyxOrderId)
    if (order) {
      return {
        userId: order.owner_user_id,
        organizationId: order.organization_id,
        telnyxOrderId,
        portingOrder: order,
        matchedBy: "telnyx_order_id",
      }
    }
  }

  if (billingPhone && telnyxOrderId) {
    const global = await getPortingOrderByTelnyxOrderIdGlobal(telnyxOrderId)
    if (global) {
      const scoped = await getPortingOrderByPhoneNumberForOwner(
        global.owner_user_id,
        billingPhone,
        global.organization_id
      )
      if (scoped) {
        return {
          userId: scoped.owner_user_id,
          organizationId: scoped.organization_id,
          telnyxOrderId: telnyxOrderId ?? scoped.telnyx_order_id,
          portingOrder: scoped,
          matchedBy: "billing_phone",
        }
      }
    }
  }

  return null
}

/** Build the in-app carrier desk feed line for exception / sub_request events. */
export function buildPortingWebhookFeedBody(
  body: Record<string, unknown>,
  eventType: string
): string {
  const lower = eventType.toLowerCase()
  const statusKeyword = extractPortingStatusKeyword(body)
  const isException =
    statusKeyword === "exception" ||
    lower.includes("sub_request.exception") ||
    lower.endsWith(".exception")

  if (isException) {
    const requirement = extractPortingCarrierRequirement(body)
    if (requirement?.exception_text) {
      return formatPortingExceptionSystemMessage(requirement.exception_text)
    }
    return formatPortingExceptionSystemMessage(
      "Passcode/pin must be provided for wireless port."
    )
  }

  return buildPortingNotificationLogBody(body, eventType)
}

/** Process one Telnyx porting webhook payload (status, comment, or sub-request exception). */
export async function processTelnyxPortingWebhook(body: Record<string, unknown>) {
  const eventType = extractEventType(body)

  if (!isTelnyxPortingWebhookEvent(eventType)) {
    return NextResponse.json({ received: true, handled: false, reason: "not_porting_event" })
  }

  const resolved = await resolvePortingWebhookOwner(body)
  if (!resolved) {
    console.log(
      JSON.stringify({
        zing: "telnyx-porting-webhook-no-owner",
        eventType,
        hint: `Set customer_reference zing-<userId>--<orgId> on port orders (${SITE_NAME} does this automatically).`,
      })
    )
    return NextResponse.json({ received: true, stored: false, reason: "no_matching_port_order" })
  }

  const { userId, organizationId, telnyxOrderId, matchedBy, portingOrder } = resolved
  const eventId = extractTelnyxEventId(body)
  const orderId = telnyxOrderId ?? findPortingOrderId(body)
  const title = buildPortingNotificationTitle(eventType)
  const text = buildPortingWebhookFeedBody(body, eventType)

  const inserted = await insertPortingNotificationIfNew({
    userId,
    organizationId,
    telnyxEventId: eventId,
    portingOrderId: orderId,
    eventType,
    title,
    body: text,
    rawPayload: body,
  })

  const actionSync = await applyPortActionRequiredFromTelnyxWebhook({
    ownerUserId: userId,
    body,
    telnyxOrderId: orderId,
  })

  const rejectionSync = await applyPortRejectionFromTelnyxWebhook({
    ownerUserId: userId,
    body,
    telnyxOrderId: orderId,
  })

  const orderSync = await syncPortingOrderFromTelnyxWebhook({
    ownerUserId: userId,
    body,
    telnyxOrderId: orderId,
  })

  if (orderSync.just_completed) {
    const numbers = [
      orderSync.phone_number?.trim(),
      ...extractPortingPhoneNumbers(body),
    ].filter(Boolean) as string[]
    const unique = [...new Set(numbers)]
    after(async () => {
      for (const phone of unique) {
        await finalizePortedNumber({
          ownerUserId: userId,
          phoneNumberE164: phone,
          telnyxOrderId: orderId,
        })
      }
    })
  }

  console.log(
    JSON.stringify({
      zing: "telnyx-porting-webhook",
      userId,
      organizationId,
      portingOrderId: portingOrder?.id ?? null,
      matchedBy,
      eventType,
      eventId,
      inserted,
      porting_action_sync: actionSync,
      porting_rejection_sync: rejectionSync,
      porting_order_sync: orderSync,
    })
  )

  return NextResponse.json({
    received: true,
    handled: true,
    matched_by: matchedBy,
    organization_id: organizationId,
    workspace_port_order_id: portingOrder?.id ?? null,
    stored: inserted,
    porting_action_applied: actionSync.applied,
    porting_rejection_applied: rejectionSync.applied,
    carrier_rejection_reason: rejectionSync.carrier_rejection_reason,
    porting_order_updated: orderSync.updated || rejectionSync.applied || actionSync.applied,
    porting_order_status: rejectionSync.applied
      ? "rejected"
      : actionSync.applied
        ? "action_required"
        : orderSync.status,
  })
}
