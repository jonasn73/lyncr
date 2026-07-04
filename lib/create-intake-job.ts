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
import { UNASSIGNED_POOL_STATUS } from "@/lib/job-pool"
import { sendIntakeBookingCustomerSms } from "@/lib/intake-booking-customer-sms"
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
}

export type CreateIntakeJobResult = {
  lead_id: string
  job_status: "UNASSIGNED"
  dispatch_status: typeof UNASSIGNED_POOL_STATUS
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

  const vehicleYear = input.vehicleYear?.trim() || null
  const vehicleMake = input.vehicleMake?.trim() || null
  const vehicleModel = input.vehicleModel?.trim() || null
  const jobType = input.jobType?.trim() || "Lockout"
  const jobAddress = formatAddress(input)
  const vehicleLabel = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ")
  const summary = [jobType, vehicleLabel || null, customerName].filter(Boolean).join(" — ")

  let latitude: number | null = input.latitude ?? null
  let longitude: number | null = input.longitude ?? null
  if ((latitude == null || longitude == null) && jobAddress) {
    const coords = await geocodeAddress(jobAddress)
    if (coords) {
      latitude = coords.lat
      longitude = coords.lng
    }
  }

  const collected: Record<string, unknown> = {
    customer_name: customerName,
    company_name: input.companyName?.trim() || null,
    job_type: jobType,
    business_type: "locksmith",
    disposition: "BOOKED",
    dispatch_status: UNASSIGNED_POOL_STATUS,
    job_status: "UNASSIGNED",
    is_salvageable: false,
    source: "answered_call_intake",
    ...(input.callLogId ? { call_log_id: input.callLogId } : {}),
    ...(vehicleYear ? { vehicle_year: vehicleYear, year: vehicleYear } : {}),
    ...(vehicleMake ? { vehicle_make: vehicleMake, make: vehicleMake } : {}),
    ...(vehicleModel ? { vehicle_model: vehicleModel, model: vehicleModel } : {}),
    ...(jobAddress ? { job_address: jobAddress, location: jobAddress, service_address: jobAddress } : {}),
    ...(input.addressLine1?.trim() ? { address_line1: input.addressLine1.trim() } : {}),
    ...(input.addressLine2?.trim() ? { address_line2: input.addressLine2.trim() } : {}),
    ...(input.city?.trim() ? { city: input.city.trim() } : {}),
    ...(input.region?.trim() ? { region: input.region.trim() } : {}),
    ...(input.postalCode?.trim() ? { postal_code: input.postalCode.trim() } : {}),
    ...(input.notes?.trim() ? { job_notes: input.notes.trim(), notes: input.notes.trim() } : {}),
    ...(input.keyFccId?.trim() ? { key_fcc_id: input.keyFccId.trim(), fcc_id: input.keyFccId.trim() } : {}),
    ...(input.keyFrequency?.trim() ? { key_frequency: input.keyFrequency.trim() } : {}),
    ...(input.keyChipset?.trim() ? { key_chipset: input.keyChipset.trim(), chip_id: input.keyChipset.trim() } : {}),
    ...(input.keyStyle?.trim() ? { key_style: input.keyStyle.trim() } : {}),
    ...(input.quotedPriceCents != null && input.quotedPriceCents > 0
      ? { last_quoted_price_cents: input.quotedPriceCents, quoted_price_cents: input.quotedPriceCents }
      : {}),
    ...(latitude != null ? { customer_lat: latitude } : {}),
    ...(longitude != null ? { customer_lng: longitude } : {}),
  }

  const sql = getSql()
  const id = crypto.randomUUID()
  const orgId = input.organizationId?.trim() || null
  const collectedJson = JSON.stringify(collected)

  if (orgId) {
    await sql`
      INSERT INTO ai_leads (
        id, user_id, organization_id, caller_e164, intent_slug, collected, summary,
        disposition, dispatch_status, is_salvageable,
        assigned_tech_id, job_status, sms_sent, sms_error, vapi_call_id, created_at
      ) VALUES (
        ${id}, ${input.ownerUserId}, ${orgId}::uuid, ${phone},
        'automotive_akl', ${collectedJson}::jsonb, ${summary},
        'BOOKED', ${UNASSIGNED_POOL_STATUS}, false,
        NULL, 'UNASSIGNED', false, NULL, ${input.callLogId ? `${input.callLogId}-intake-job` : `${id}-intake`}, now()
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
        'BOOKED', ${UNASSIGNED_POOL_STATUS}, false,
        NULL, 'UNASSIGNED', false, NULL, ${input.callLogId ? `${input.callLogId}-intake-job` : `${id}-intake`}, now()
      )
    `
  }

  await applyLeadDisposition(id, {
    disposition: "BOOKED",
    dispatch_status: UNASSIGNED_POOL_STATUS,
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

  const sms = await sendIntakeBookingCustomerSms({
    ownerUserId: input.ownerUserId,
    leadId: id,
    customerPhoneE164: phone,
    customerName,
  })
  await updateAiLeadSmsOutcome(id, { sms_sent: sms.sent, sms_error: sms.error })

  await publishOwnerEvent(input.ownerUserId, "job-booked", {
    leadId: id,
    customerName,
    dispatch_status: UNASSIGNED_POOL_STATUS,
    job_status: "UNASSIGNED",
  }).catch((e) => console.warn("[create-intake-job] job-booked publish failed:", e))

  void getUser(input.ownerUserId)

  return {
    lead_id: id,
    job_status: "UNASSIGNED",
    dispatch_status: UNASSIGNED_POOL_STATUS,
    latitude,
    longitude,
    customer_sms_sent: sms.sent,
    customer_sms_error: sms.error,
    tracking_url: sms.tracking_url,
  }
}
