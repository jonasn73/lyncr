// POST /api/affiliates/[id]/send-lead — SMS/webhook partner + mark job referred out.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  buildAffiliateLeadSms,
  getAffiliateLocksmithById,
  serializeAffiliateForApi,
} from "@/lib/affiliate-locksmiths"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

export const dynamic = "force-dynamic"

type Body = {
  caller_e164?: string
  customer_name?: string
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  region?: string | null
  postal_code?: string | null
  country?: string | null
  notes?: string | null
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  key_fcc_id?: string | null
  key_style?: string | null
  call_log_id?: string | null
  organization_id?: string | null
  quoted_price_cents?: number | null
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await ctx.params
  const affiliate = await getAffiliateLocksmithById(userId, id.trim())
  if (!affiliate) {
    return NextResponse.json({ error: "Affiliate not found" }, { status: 404 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const customerName = String(body.customer_name ?? "").trim()
  const callerE164 = String(body.caller_e164 ?? "").trim()
  if (!customerName || !callerE164) {
    return NextResponse.json({ error: "customer_name and caller_e164 are required" }, { status: 400 })
  }

  const vehicleLabel = [body.vehicle_year, body.vehicle_make, body.vehicle_model]
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(" ")
  const address = [
    body.address_line1,
    body.address_line2,
    [body.city, body.region].filter(Boolean).join(", "),
    body.postal_code,
  ]
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(", ")

  const affiliateApi = serializeAffiliateForApi(affiliate)
  const smsText = buildAffiliateLeadSms({
    partnerName: affiliate.name,
    customerName,
    customerPhone: callerE164,
    vehicleLabel,
    address,
    notes: body.notes,
    commissionLabel: affiliateApi.commissionLabel,
  })

  try {
    const sms = await sendTelnyxSms({
      toE164: affiliate.phoneE164,
      text: smsText,
      userId,
    })

    if (affiliate.webhookUrl) {
      void fetch(affiliate.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "lyncr.partner_lead",
          affiliate_id: affiliate.id,
          affiliate_name: affiliate.name,
          customer_name: customerName,
          customer_phone: callerE164,
          vehicle: vehicleLabel,
          address,
          notes: body.notes ?? null,
          commission_cents: affiliate.commissionCents,
          sms_sent: sms.ok,
        }),
      }).catch((e) => console.warn("[affiliates/send-lead] webhook failed", e))
    }

    const orgRaw = body.organization_id?.trim() || null
    const organizationId = orgRaw && !orgRaw.startsWith("legacy-") ? orgRaw : null

    const job = await createUnassignedJobFromIntake({
      ownerUserId: userId,
      organizationId,
      callLogId: body.call_log_id?.trim() || null,
      callerE164,
      customerName,
      addressLine1: body.address_line1?.trim() || "Partner referral — address TBD",
      addressLine2: body.address_line2?.trim() || null,
      city: body.city?.trim() || "TBD",
      region: body.region?.trim() || null,
      postalCode: body.postal_code?.trim() || null,
      country: body.country?.trim() || "US",
      notes: [
        body.notes?.trim(),
        `Referred to ${affiliate.name} (${affiliate.phoneE164}).`,
        `Status: Referred out - ${affiliateApi.commissionLabel} Commission Pending`,
      ]
        .filter(Boolean)
        .join(" "),
      vehicleYear: body.vehicle_year?.trim() || null,
      vehicleMake: body.vehicle_make?.trim() || null,
      vehicleModel: body.vehicle_model?.trim() || null,
      keyFccId: body.key_fcc_id?.trim() || null,
      keyStyle: body.key_style?.trim() || null,
      quotedPriceCents: body.quoted_price_cents != null ? Number(body.quoted_price_cents) : null,
      pendingCallback: true,
      stockFallback: {
        kind: "referred_out",
        affiliateId: affiliate.id,
        affiliateName: affiliate.name,
        commissionCents: affiliate.commissionCents,
      },
    })

    return NextResponse.json({
      data: {
        lead_id: job.lead_id,
        job_status: job.job_status,
        referral_status: `Referred out - ${affiliateApi.commissionLabel} Commission Pending`,
        affiliate: affiliateApi,
        partner_sms_sent: sms.ok,
        partner_sms_error: sms.ok ? null : sms.error ?? "SMS failed",
      },
    })
  } catch (e) {
    console.error("[affiliates/send-lead]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not send partner lead" },
      { status: 500 }
    )
  }
}
