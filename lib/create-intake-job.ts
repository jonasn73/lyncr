// Create an unassigned hopper job from the owner answered-call intake sheet.

import {
  applyLeadDisposition,
  getUser,
  isReasonablePstnDialString,
  markCallLogOwnerIntakeDismissed,
  normalizePhoneNumberE164,
  setLeadCoordinates,
  updateAiLeadSmsOutcome,
} from "@/lib/db"
import { geocodeAddress } from "@/lib/geocode"
import { UNASSIGNED_POOL_STATUS, UNASSIGNED_CALLBACK_STATUS, PENDING_CALLBACK_ADDRESS, CRM_LEAD_STATUS, LOST_LEAD_STATUS } from "@/lib/job-pool"
import { sendIntakeBookingCustomerSms } from "@/lib/intake-booking-customer-sms"
import {
  buildIntakePricingMetadata,
  getOwnerServiceRateCard,
} from "@/lib/service-rate-card"
import {
  calculateServiceQuote,
  serviceQuoteTypeIdFromIntake,
  type ServiceQuoteTypeId,
} from "@/lib/service-quote-calculator"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { neon } from "@neondatabase/serverless"

export type CreateIntakeJobInput = {
  ownerUserId: string
  organizationId?: string | null
  callLogId?: string | null
  callerE164: string
  customerName: string
  companyName?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
  notes?: string | null
  vehicleYear?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  jobType?: string | null
  keyFccId?: string | null
  keyFrequency?: string | null
  keyChipset?: string | null
  keyStyle?: string | null
  latitude?: number | null
  longitude?: number | null
  quotedPriceCents?: number | null
  /** Straight-line miles from dispatcher to job (from intake GPS + address). */
  distanceMiles?: number | null
  /** Calculator service id (lockout, key_gen, …) — used with DB rate card server-side. */
  serviceQuoteTypeId?: string | null
  keyStyle?: string | null
  keyChipset?: string | null
  keyVariantId?: string | null
  /** Most recent negotiation preset applied before booking. */
  discountApplied?: string | null
  /** Auto-calculated quote before negotiation discounts. */
  baselineQuotedPriceCents?: number | null
  /** Customer recovered via price-shopper route-match script. */
  recoveredViaRouteDiscount?: boolean
  /** Update an existing ai_leads row (CRM convert → intake complete) instead of inserting. */
  existingLeadId?: string | null
  /** Save without map-ready address — lands in hopper as a callback lead. */
  pendingCallback?: boolean
}

export type CreateIntakeJobResult = {
  lead_id: string
  job_status: "UNASSIGNED"
  dispatch_status: typeof UNASSIGNED_POOL_STATUS | typeof UNASSIGNED_CALLBACK_STATUS
  latitude: number | null
  longitude: number | null
  customer_sms_sent: boolean
  customer_sms_error: string | null
  tracking_url: string
}

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

function formatAddress(params: CreateIntakeJobInput): string | null {
  const parts = [
    params.addressLine1?.trim(),
    params.addressLine2?.trim(),
    [params.city?.trim(), params.region?.trim()].filter(Boolean).join(", "),
    params.postalCode?.trim(),
    params.country?.trim() && params.country.trim() !== "US" ? params.country.trim() : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : null
}

export async function createUnassignedJobFromIntake(input: CreateIntakeJobInput): Promise<CreateIntakeJobResult> {
  const phone = normalizePhoneNumberE164(input.callerE164)
  if (!isReasonablePstnDialString(phone)) {
    throw new Error("Enter a valid caller phone number.")
  }
  const customerName = input.customerName.trim()
  if (!customerName) throw new Error("Customer name is required.")

  const pendingCallback = Boolean(input.pendingCallback)
  const addressLine1 =
    input.addressLine1?.trim() ||
    (pendingCallback ? PENDING_CALLBACK_ADDRESS : null)
  const city = input.city?.trim() || (pendingCallback ? "CALLBACK" : null)
  const region = input.region?.trim() || null
  const postalCode = input.postalCode?.trim() || null
  const country = input.country?.trim() || "US"

  const vehicleYear = input.vehicleYear?.trim() || null
  const vehicleMake = input.vehicleMake?.trim() || null
  const vehicleModel = input.vehicleModel?.trim() || null
  const jobType = input.jobType?.trim() || "Lockout"
  const jobAddress = formatAddress({
    ...input,
    addressLine1,
    city,
    region,
    postalCode,
    country,
  })
  const vehicleLabel = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ")
  const summary = [jobType, vehicleLabel || null, customerName].filter(Boolean).join(" — ")

  let keyMode = ""
  if (jobType.includes("Duplication")) keyMode = "Duplication"
  else if (jobType.includes("Origination")) keyMode = "Origination"
  const intakeJobType = jobType.startsWith("Key replacement") ? "Key replacement" : jobType

  let latitude: number | null = input.latitude ?? null
  let longitude: number | null = input.longitude ?? null
  if (
    !pendingCallback &&
    addressLine1 !== PENDING_CALLBACK_ADDRESS &&
    (latitude == null || longitude == null) &&
    jobAddress
  ) {
    const coords = await geocodeAddress(jobAddress)
    if (coords) {
      latitude = coords.lat
      longitude = coords.lng
    }
  }

  const { rateCard, source: rateCardSource } = await getOwnerServiceRateCard(input.ownerUserId)
  const serviceTypeId = (
    input.serviceQuoteTypeId?.trim() ||
    serviceQuoteTypeIdFromIntake(intakeJobType, keyMode)
  ) as ServiceQuoteTypeId
  const quote = calculateServiceQuote({
    serviceTypeId,
    vehicleYear: vehicleYear ?? undefined,
    vehicleMake: vehicleMake ?? undefined,
    vehicleModel: vehicleModel ?? undefined,
    rateCard,
    rateCardSource,
    distanceMiles: input.distanceMiles ?? null,
    keyStyle: input.keyStyle ?? undefined,
    keyChipset: input.keyChipset ?? undefined,
    keyVariantId: input.keyVariantId ?? undefined,
  })
  const quotedPriceCents =
    input.quotedPriceCents != null &&
    Number.isFinite(input.quotedPriceCents) &&
    input.quotedPriceCents > 0
      ? Math.round(input.quotedPriceCents)
      : quote.totalCents
  const pricingMetadata = buildIntakePricingMetadata({
    quote: { ...quote, totalCents: quotedPriceCents },
    vehicleYear,
    vehicleMake,
    vehicleModel,
    rateCardSource,
  })

  const dispatchStatus = pendingCallback ? CRM_LEAD_STATUS : UNASSIGNED_POOL_STATUS
  const disposition = pendingCallback ? "PENDING_TIME" : "BOOKED"

  const collected: Record<string, unknown> = {
    customer_name: customerName,
    company_name: input.companyName?.trim() || null,
    job_type: jobType,
    business_type: "locksmith",
    disposition,
    dispatch_status: dispatchStatus,
    status: pendingCallback ? CRM_LEAD_STATUS : "active_booking",
    job_status: pendingCallback ? CRM_LEAD_STATUS : "UNASSIGNED",
    is_salvageable: false,
    source: pendingCallback ? "answered_call_pending_callback" : "answered_call_intake",
    ...(pendingCallback
      ? { pending_callback: true, sales_recovery_stage: "pending_callbacks" }
      : {}),
    ...(input.callLogId ? { call_log_id: input.callLogId } : {}),
    ...(vehicleYear ? { vehicle_year: vehicleYear, year: vehicleYear } : {}),
    ...(vehicleMake ? { vehicle_make: vehicleMake, make: vehicleMake } : {}),
    ...(vehicleModel ? { vehicle_model: vehicleModel, model: vehicleModel } : {}),
    ...(jobAddress ? { job_address: jobAddress, location: jobAddress, service_address: jobAddress } : {}),
    ...(addressLine1 ? { address_line1: addressLine1 } : {}),
    ...(input.addressLine2?.trim() ? { address_line2: input.addressLine2.trim() } : {}),
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
    ...(postalCode ? { postal_code: postalCode } : {}),
    ...(input.notes?.trim() ? { job_notes: input.notes.trim(), notes: input.notes.trim() } : {}),
    ...(input.keyFccId?.trim() ? { key_fcc_id: input.keyFccId.trim(), fcc_id: input.keyFccId.trim() } : {}),
    ...(input.keyFrequency?.trim() ? { key_frequency: input.keyFrequency.trim() } : {}),
    ...(input.keyChipset?.trim() ? { key_chipset: input.keyChipset.trim(), chip_id: input.keyChipset.trim() } : {}),
    ...(input.keyStyle?.trim() ? { key_style: input.keyStyle.trim() } : {}),
    ...(input.keyVariantId?.trim() ? { key_variant_id: input.keyVariantId.trim() } : {}),
    service_quote_type_id: serviceTypeId,
    ...(quotedPriceCents > 0
      ? {
          last_quoted_price_cents: quotedPriceCents,
          quoted_price_cents: quotedPriceCents,
          pricing_metadata: pricingMetadata,
        }
      : {}),
    ...(input.baselineQuotedPriceCents != null && input.baselineQuotedPriceCents > 0
      ? { baseline_quoted_price_cents: Math.round(input.baselineQuotedPriceCents) }
      : {}),
    ...(input.discountApplied?.trim()
      ? {
          discount_applied: input.discountApplied.trim(),
          negotiation_outcome: input.recoveredViaRouteDiscount
            ? "recovered_via_route_discount"
            : "booked_with_discount",
        }
      : {}),
    ...(input.recoveredViaRouteDiscount
      ? { recovered_via_route_discount: true }
      : {}),
    ...(latitude != null ? { customer_lat: latitude } : {}),
    ...(longitude != null ? { customer_lng: longitude } : {}),
  }

  const sql = getSql()
  const existingLeadId = input.existingLeadId?.trim() || null
  const id = existingLeadId ?? crypto.randomUUID()
  const orgId = input.organizationId?.trim() || null
  const collectedJson = JSON.stringify(collected)

  if (existingLeadId) {
    const updated =
      orgId != null
        ? await sql`
            UPDATE ai_leads
            SET
              caller_e164 = ${phone},
              summary = ${summary},
              disposition = ${disposition},
              dispatch_status = ${dispatchStatus},
              job_status = ${pendingCallback ? CRM_LEAD_STATUS : "UNASSIGNED"},
              organization_id = ${orgId}::uuid,
              collected = coalesce(collected, '{}'::jsonb) || ${collectedJson}::jsonb
            WHERE id = ${existingLeadId} AND user_id = ${input.ownerUserId}
            RETURNING id
          `
        : await sql`
            UPDATE ai_leads
            SET
              caller_e164 = ${phone},
              summary = ${summary},
              disposition = ${disposition},
              dispatch_status = ${dispatchStatus},
              job_status = ${pendingCallback ? CRM_LEAD_STATUS : "UNASSIGNED"},
              collected = coalesce(collected, '{}'::jsonb) || ${collectedJson}::jsonb
            WHERE id = ${existingLeadId} AND user_id = ${input.ownerUserId}
            RETURNING id
          `
    if (updated.length === 0) {
      throw new Error("Lead not found or you do not have access.")
    }
  } else if (orgId) {
    await sql`
      INSERT INTO ai_leads (
        id, user_id, organization_id, caller_e164, intent_slug, collected, summary,
        disposition, dispatch_status, is_salvageable,
        assigned_tech_id, job_status, sms_sent, sms_error, vapi_call_id, created_at
      ) VALUES (
        ${id}, ${input.ownerUserId}, ${orgId}::uuid, ${phone},
        'automotive_akl', ${collectedJson}::jsonb, ${summary},
        ${disposition}, ${dispatchStatus}, false,
        NULL, ${pendingCallback ? CRM_LEAD_STATUS : "UNASSIGNED"}, false, NULL, ${input.callLogId ? `${input.callLogId}-intake-job` : `${id}-intake`}, now()
      )
    `
  } else {
    await sql`
      INSERT INTO ai_leads (
        id, user_id, caller_e164, intent_slug, collected, summary,
        disposition, dispatch_status, is_salvageable,
        assigned_tech_id, job_status, sms_sent, sms_error, vapi_call_id, created_at
      ) VALUES (
        ${id}, ${input.ownerUserId}, ${phone},
        'automotive_akl', ${collectedJson}::jsonb, ${summary},
        ${disposition}, ${dispatchStatus}, false,
        NULL, ${pendingCallback ? CRM_LEAD_STATUS : "UNASSIGNED"}, false, NULL, ${input.callLogId ? `${input.callLogId}-intake-job` : `${id}-intake`}, now()
      )
    `
  }

  await applyLeadDisposition(id, {
    disposition,
    dispatch_status: dispatchStatus,
    is_salvageable: false,
  })

  if (input.callLogId?.trim()) {
    await markCallLogOwnerIntakeDismissed(input.ownerUserId, input.callLogId.trim()).catch((e) =>
      console.warn("[create-intake-job] intake dismiss stamp failed:", e)
    )
  }

  if (latitude != null && longitude != null) {
    await setLeadCoordinates(id, latitude, longitude)
  }

  const sms = pendingCallback
    ? { sent: false, error: null, tracking_url: "" }
    : await sendIntakeBookingCustomerSms({
        ownerUserId: input.ownerUserId,
        leadId: id,
        customerPhoneE164: phone,
        customerName,
      })
  if (!pendingCallback) {
    await updateAiLeadSmsOutcome(id, { sms_sent: sms.sent, sms_error: sms.error })
  }

  await publishOwnerEvent(
    input.ownerUserId,
    pendingCallback ? "lead-salvageable" : "job-booked",
    {
      leadId: id,
      customerName,
      dispatch_status: dispatchStatus,
      job_status: pendingCallback ? CRM_LEAD_STATUS : "UNASSIGNED",
    }
  ).catch((e) => console.warn("[create-intake-job] intake publish failed:", e))

  void getUser(input.ownerUserId)

  return {
    lead_id: id,
    job_status: pendingCallback ? CRM_LEAD_STATUS : "UNASSIGNED",
    dispatch_status: dispatchStatus,
    latitude,
    longitude,
    customer_sms_sent: sms.sent,
    customer_sms_error: sms.error,
    tracking_url: sms.tracking_url,
  }
}
