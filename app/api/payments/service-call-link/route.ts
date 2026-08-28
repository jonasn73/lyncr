// POST /api/payments/service-call-link
// Operator: save a quote lead (optional) + text a $49 service-call form+pay link.

import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceActor } from "@/lib/workspace-actor"
import { getUser } from "@/lib/db"
import { isStripeConfigured } from "@/lib/stripe-config"
import {
  createCollectPayLinkCheckout,
  sendCollectPayLink,
} from "@/lib/job-pay-link"
import { getAppUrl } from "@/lib/telnyx"
import {
  SERVICE_CALL_FEE_CENTS,
  SERVICE_CALL_FEE_DOLLARS,
  SERVICE_CALL_FEE_LABEL,
  buildServiceCallFormUrl,
} from "@/lib/service-call-fee"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Body = {
  jobId?: string
  phone?: string
  customerName?: string
  note?: string
}

export async function POST(req: NextRequest) {
  // Must be logged in as the shop owner / operator
  const actor = await resolveWorkspaceActor(req.headers.get("cookie"), {
    capability: "invoicing_send",
  })
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const userId = actor.ownerUserId

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in Vercel / .env.local." },
      { status: 503 }
    )
  }

  const body = (await req.json().catch(() => ({}))) as Body
  const phone = String(body.phone ?? "").trim()
  if (!phone) {
    return NextResponse.json({ error: "Customer phone is required" }, { status: 400 })
  }

  const jobId = String(body.jobId ?? "").trim() || null
  const customerName = String(body.customerName ?? "").trim() || undefined
  const note =
    String(body.note ?? "").trim() ||
    `${SERVICE_CALL_FEE_LABEL} — tech on the way after payment`

  try {
    // Create Stripe embedded checkout + short pay token (tied to lead when jobId set)
    const checkout = await createCollectPayLinkCheckout({
      actingUserId: userId,
      jobId,
      chargeCents: SERVICE_CALL_FEE_CENTS,
      subtotalCents: SERVICE_CALL_FEE_CENTS,
      taxCents: 0,
      note,
      customerName,
      lineSummary: SERVICE_CALL_FEE_LABEL,
    })

    // Customer lands on the short form first, then pays via /pay/{token}
    const formUrl = buildServiceCallFormUrl(getAppUrl(), checkout.payToken)
    const businessLabel = user.business_name?.trim() || user.name?.trim() || "Lyncr"

    const sent = await sendCollectPayLink({
      actingUserId: userId,
      channel: "sms",
      url: formUrl,
      chargeCents: SERVICE_CALL_FEE_CENTS,
      customerName,
      phone,
      businessLabel,
    })

    if (!sent.sent) {
      return NextResponse.json(
        {
          error: sent.error || "Could not send SMS",
          data: {
            pay_token: checkout.payToken,
            form_url: formUrl,
            amount_dollars: SERVICE_CALL_FEE_DOLLARS,
          },
        },
        { status: 502 }
      )
    }

    return NextResponse.json({
      data: {
        pay_token: checkout.payToken,
        form_url: formUrl,
        amount_dollars: SERVICE_CALL_FEE_DOLLARS,
        job_id: jobId,
      },
    })
  } catch (e) {
    console.error("[service-call-link]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create service-call link" },
      { status: 500 }
    )
  }
}
