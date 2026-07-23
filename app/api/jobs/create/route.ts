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
  key_variant_id?: string | null
  field_verification_required?: boolean
  vehicle_trim?: string | null
  factory_options?: string[] | null
  vehicle_vin?: string | null
  plate_number?: string | null
  plate_state?: string | null
  programming_method?: string | null
  /** Transponder Island ordering SKU (e.g. TIK-SUB-37A). */
  ti_sku?: string | null
  scheduled_at?: string | null
  customer_lat?: number | null
  customer_lng?: number | null
  quoted_price_cents?: number | null
  distance_miles?: number | null
  service_quote_type_id?: string | null
  pending_callback?: boolean
  /** mobile | shop — where the work happens. */
  service_venue?: "mobile" | "shop" | null
  /** Customer already has the key (cut & program only). */
  customer_owns_key?: boolean
  organization_id?: string | null
  discount_applied?: string | null
  baseline_quote_cents?: number | null
  calculated_total_cents?: number | null
  final_booked_total_cents?: number | null
  is_price_overridden?: boolean
  /** Dollar floats for negotiation metrics (optional; cents fields preferred). */
  calculatedTotal?: number | null
  finalBookedTotal?: number | null
  isPriceOverridden?: boolean
  recovered_via_route_discount?: boolean
  existing_lead_id?: string | null
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
      keyVariantId: body.key_variant_id?.trim() || null,
      latitude: body.customer_lat != null ? Number(body.customer_lat) : null,
      longitude: body.customer_lng != null ? Number(body.customer_lng) : null,
      quotedPriceCents: body.quoted_price_cents != null ? Number(body.quoted_price_cents) : null,
      distanceMiles: body.distance_miles != null ? Number(body.distance_miles) : null,
      serviceQuoteTypeId: body.service_quote_type_id?.trim() || null,
      vehicleTrim: body.vehicle_trim?.trim() || null,
      factoryOptions: Array.isArray(body.factory_options)
        ? body.factory_options.map((entry) => String(entry).trim()).filter(Boolean)
        : null,
      vehicleVin: body.vehicle_vin?.trim() || null,
      plateNumber: body.plate_number?.trim() || null,
      plateState: body.plate_state?.trim() || null,
      programmingMethod: body.programming_method?.trim() || null,
      tiSku: body.ti_sku?.trim() || null,
      scheduledAtIso: body.scheduled_at?.trim() || null,
      pendingCallback: body.pending_callback === true,
      serviceVenue:
        body.service_venue === "shop" || body.service_venue === "mobile"
          ? body.service_venue
          : null,
      customerOwnsKey: body.customer_owns_key === true,
      discountApplied: body.discount_applied?.trim() || null,
      baselineQuotedPriceCents:
        body.baseline_quote_cents != null && Number.isFinite(Number(body.baseline_quote_cents))
          ? Math.round(Number(body.baseline_quote_cents))
          : null,
      calculatedTotalCents: (() => {
        if (body.calculated_total_cents != null && Number.isFinite(Number(body.calculated_total_cents))) {
          return Math.round(Number(body.calculated_total_cents))
        }
        if (body.calculatedTotal != null && Number.isFinite(Number(body.calculatedTotal))) {
          return Math.round(Number(body.calculatedTotal) * 100)
        }
        return null
      })(),
      finalBookedTotalCents: (() => {
        if (
          body.final_booked_total_cents != null &&
          Number.isFinite(Number(body.final_booked_total_cents))
        ) {
          return Math.round(Number(body.final_booked_total_cents))
        }
        if (body.finalBookedTotal != null && Number.isFinite(Number(body.finalBookedTotal))) {
          return Math.round(Number(body.finalBookedTotal) * 100)
        }
        return null
      })(),
      isPriceOverridden: body.is_price_overridden === true || body.isPriceOverridden === true,
      recoveredViaRouteDiscount: body.recovered_via_route_discount === true,
      existingLeadId: body.existing_lead_id?.trim() || null,
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
