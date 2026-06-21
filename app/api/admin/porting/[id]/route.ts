// GET / POST /api/admin/porting/[id]
// Admin porting control desk — order detail, notifications timeline, Telnyx corrections.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { buildAdminPortingPipeline } from "@/lib/admin-porting-timeline"
import {
  getPortingOrderById,
  listPortingNotificationsChronological,
  patchPortingOrderFields,
} from "@/lib/db"
import {
  isPortingNotificationActionNeeded,
  latestActionNeededNotification,
} from "@/lib/porting-notification-ui"
import {
  backfillPortingExceptionsFromTelnyxOrder,
  backfillPortingNotificationsFromTelnyxComments,
  syncPortingOrderFromTelnyxLive,
} from "@/lib/porting-telnyx-sync"
import {
  labelForPortingStatus,
  resolveLiveTelnyxPortStatus,
} from "@/lib/telnyx-porting-status"
import { submitTelnyxPortingCorrections } from "@/lib/telnyx-lnp-update"
import {
  createTelnyxPortingOrderComment,
  fetchTelnyxPortingOrderById,
  listTelnyxPortingOrderComments,
} from "@/lib/telnyx-porting-orders"
import type { AdminPortingCorrectionRequest, AdminPortingDeskDetail } from "@/lib/types"

export const dynamic = "force-dynamic"

async function loadDeskDetail(orderId: string): Promise<AdminPortingDeskDetail | null> {
  let order = await getPortingOrderById(orderId)
  if (!order) return null

  const telnyxOrderId = order.telnyx_order_id?.trim() || ""

  // Pull live Telnyx state when webhooks lag (also fixes stale DB status in admin desk).
  order = await syncPortingOrderFromTelnyxLive(order)

  if (telnyxOrderId) {
    await Promise.all([
      backfillPortingNotificationsFromTelnyxComments({
        ownerUserId: order.owner_user_id,
        telnyxOrderId,
      }),
      backfillPortingExceptionsFromTelnyxOrder({
        ownerUserId: order.owner_user_id,
        telnyxOrderId,
        organizationId: order.organization_id,
      }),
    ]).catch((e) => console.warn("[admin/porting] notification backfill:", e))
  }

  const [notifications, telnyxComments, telnyxLive] = await Promise.all([
    telnyxOrderId
      ? listPortingNotificationsChronological(order.owner_user_id, telnyxOrderId)
      : Promise.resolve([]),
    telnyxOrderId
      ? listTelnyxPortingOrderComments(telnyxOrderId).catch(() => [])
      : Promise.resolve([]),
    telnyxOrderId ? fetchTelnyxPortingOrderById(telnyxOrderId) : Promise.resolve(null),
  ])

  const liveStatus = resolveLiveTelnyxPortStatus(telnyxLive, order.telnyx_status)

  const actionAlerts = notifications.filter((n) =>
    isPortingNotificationActionNeeded(n.event_type, n.title)
  )
  const latestAlert = latestActionNeededNotification(notifications)
  if (latestAlert && !actionAlerts.some((a) => a.id === latestAlert.id)) {
    actionAlerts.push(latestAlert)
  }

  return {
    order,
    notifications,
    telnyx_comments: [...telnyxComments].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ),
    telnyx_live_status: liveStatus,
    telnyx_status_label: labelForPortingStatus(liveStatus),
    pipeline_steps: buildAdminPortingPipeline({ ...order, telnyx_status: liveStatus }),
    action_alerts: actionAlerts,
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireLyncrAdmin(req)
  if (guard instanceof NextResponse) return guard
  const { id } = await ctx.params

  try {
    const detail = await loadDeskDetail(id)
    if (!detail) return NextResponse.json({ error: "Porting order not found" }, { status: 404 })
    return NextResponse.json({ data: detail })
  } catch (e) {
    console.error("[admin/porting] GET detail:", e)
    return NextResponse.json({ error: "Could not load porting order" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireLyncrAdmin(req)
  if (guard instanceof NextResponse) return guard
  const { id } = await ctx.params

  const order = await getPortingOrderById(id)
  if (!order) return NextResponse.json({ error: "Porting order not found" }, { status: 404 })

  const telnyxOrderId = order.telnyx_order_id?.trim()
  if (!telnyxOrderId) {
    return NextResponse.json({ error: "This order has no Telnyx order id yet" }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as AdminPortingCorrectionRequest

  const hasFieldCorrection = Boolean(
    body.account_number?.trim() ||
      body.pin?.trim() ||
      body.street_address?.trim() ||
      body.city?.trim() ||
      body.state?.trim() ||
      body.postal_code?.trim() ||
      body.entity_name?.trim() ||
      body.authorized_person?.trim() ||
      body.loa_base64?.trim() ||
      body.invoice_base64?.trim()
  )
  const hasComment = Boolean(body.carrier_comment?.trim())

  if (!hasFieldCorrection && !hasComment) {
    return NextResponse.json({ error: "Provide at least one correction field or carrier comment" }, { status: 400 })
  }

  try {
    let correctionResult: Awaited<ReturnType<typeof submitTelnyxPortingCorrections>> | null = null

    if (hasFieldCorrection) {
      correctionResult = await submitTelnyxPortingCorrections({
        telnyxOrderId,
        accountNumber: body.account_number?.trim(),
        pin: body.pin?.trim(),
        streetAddress: body.street_address?.trim(),
        city: body.city?.trim(),
        state: body.state?.trim(),
        postalCode: body.postal_code?.trim(),
        entityName: body.entity_name?.trim(),
        authorizedPerson: body.authorized_person?.trim(),
        loaBase64: body.loa_base64?.trim(),
        loaFilename: body.loa_filename?.trim(),
        invoiceBase64: body.invoice_base64?.trim(),
        invoiceFilename: body.invoice_filename?.trim(),
      })

      await patchPortingOrderFields(id, {
        ...(body.account_number?.trim() ? { account_number: body.account_number.trim() } : {}),
        ...(body.pin !== undefined ? { pin_or_sid: body.pin.trim() || null } : {}),
        telnyx_status: correctionResult.telnyxStatus,
        status: correctionResult.orderStatus,
      })
    }

    if (hasComment && body.carrier_comment?.trim()) {
      await createTelnyxPortingOrderComment(telnyxOrderId, body.carrier_comment.trim())
    }

    const detail = await loadDeskDetail(id)
    return NextResponse.json({
      data: {
        ok: true,
        correction: correctionResult,
        detail,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Correction submit failed"
    console.error("[admin/porting] POST correction:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
