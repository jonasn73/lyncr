// POST /api/jobs/create — answered-call intake → unassigned hopper job + customer SMS.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"

export const dynamic = "force-dynamic"

type CreateJobBody = {
  call_log_id?: string | null
  caller_e164?: string | null
  customer_name?: string | null
  company_name?: string | null
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
  job_type?: string | null
  key_fcc_id?: string | null
  key_frequency?: string | null
  key_chipset?: string | null
  key_style?: string | null
  organization_id?: string | null
  customer_lat?: number | null
  customer_lng?: number | null
  quoted_price_cents?: number | null
  service_quote_type_id?: string | null
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const body = (await req.json().catch(() => ({}))) as CreateJobBody
    const orgRaw = body.organization_id?.trim() || null
    const organizationId = orgRaw && !orgRaw.startsWith("legacy-") ? orgRaw : null

    const result = await createUnassignedJobFromIntake({
      ownerUserId: userId,
      organizationId,
      callLogId: body.call_log_id?.trim() || null,
      callerE164: String(body.caller_e164 ?? "").trim(),
      customerName: String(body.customer_name ?? "").trim(),
      companyName: body.company_name?.trim() || null,
      addressLine1: body.address_line1?.trim() || null,
      addressLine2: body.address_line2?.trim() || null,
      city: body.city?.trim() || null,
      region: body.region?.trim() || null,
      postalCode: body.postal_code?.trim() || null,
      country: body.country?.trim() || null,
      notes: body.notes?.trim() || null,
      vehicleYear: body.vehicle_year?.trim() || null,
      vehicleMake: body.vehicle_make?.trim() || null,
      vehicleModel: body.vehicle_model?.trim() || null,
      jobType: body.job_type?.trim() || null,
      keyFccId: body.key_fcc_id?.trim() || null,
      keyFrequency: body.key_frequency?.trim() || null,
      keyChipset: body.key_chipset?.trim() || null,
      keyStyle: body.key_style?.trim() || null,
      latitude: body.customer_lat != null ? Number(body.customer_lat) : null,
      longitude: body.customer_lng != null ? Number(body.customer_lng) : null,
      quotedPriceCents: body.quoted_price_cents != null ? Number(body.quoted_price_cents) : null,
      serviceQuoteTypeId: body.service_quote_type_id?.trim() || null,
    })

    return NextResponse.json({ data: result })
  } catch (e) {
    console.error("[POST /api/jobs/create]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create job." },
      { status: 400 }
    )
  }
}
