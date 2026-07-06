// POST /api/leads/lost — log a price-shopper / hang-up lead from the intake sheet.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { insertLostLead } from "@/lib/lost-leads"
import { markAiLeadAsCrmLost } from "@/lib/db"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"

export const dynamic = "force-dynamic"

type LostLeadBody = {
  call_log_id?: string | null
  phone_number?: string | null
  last_quoted_price_cents?: number | null
  baseline_quote_cents?: number | null
  discount_applied?: string | null
  negotiation_discounts_tried?: string[] | null
  failure_reason?: string | null
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  service_type?: string | null
  organization_id?: string | null
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const body = (await req.json().catch(() => ({}))) as LostLeadBody
    const phone = String(body.phone_number ?? "").trim()
    const failureReason = String(body.failure_reason ?? "").trim()
    if (!phone) return NextResponse.json({ error: "phone_number is required" }, { status: 400 })
    if (!failureReason) return NextResponse.json({ error: "failure_reason is required" }, { status: 400 })

    const orgRaw = body.organization_id?.trim() || null
    const organizationId = orgRaw && !orgRaw.startsWith("legacy-") ? orgRaw : null

    const discountsTried = Array.isArray(body.negotiation_discounts_tried)
      ? body.negotiation_discounts_tried.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim())
      : []

    const result = await insertLostLead({
      ownerUserId: userId,
      organizationId,
      callLogId: body.call_log_id?.trim() || null,
      phoneNumber: phone,
      lastQuotedPriceCents:
        body.last_quoted_price_cents != null ? Number(body.last_quoted_price_cents) : null,
      failureReason,
      vehicleYear: body.vehicle_year?.trim() || null,
      vehicleMake: body.vehicle_make?.trim() || null,
      vehicleModel: body.vehicle_model?.trim() || null,
      serviceType: body.service_type?.trim() || null,
      collected: {
        source: "answered_call_intake",
        status: "lost_lead",
        ...(failureReason.toLowerCase().includes("price") && failureReason.toLowerCase().includes("high")
          ? { sub_status: "price_too_high" }
          : {}),
        baseline_quote_cents:
          body.baseline_quote_cents != null && Number.isFinite(Number(body.baseline_quote_cents))
            ? Math.round(Number(body.baseline_quote_cents))
            : null,
        target_price_cents:
          body.last_quoted_price_cents != null && Number.isFinite(Number(body.last_quoted_price_cents))
            ? Math.round(Number(body.last_quoted_price_cents))
            : null,
        discount_applied: body.discount_applied?.trim() || null,
        negotiation_discounts_tried: discountsTried,
        negotiation_outcome: "declined_after_pitch",
      },
    })

    await markAiLeadAsCrmLost({
      ownerUserId: userId,
      callLogId: body.call_log_id?.trim() || null,
      phoneE164: phone,
      failureReason,
    }).catch((e) => console.warn("[POST /api/leads/lost] ai_leads mark lost failed:", e))

    await publishOwnerEvent(userId, "lead-salvageable", {
      leadId: result.id,
      reason: failureReason,
    }).catch((e) => console.warn("[POST /api/leads/lost] pusher failed:", e))

    return NextResponse.json({ data: { id: result.id, status: "lost_lead" } })
  } catch (e) {
    console.error("[POST /api/leads/lost]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not log lost lead." },
      { status: 400 }
    )
  }
}
