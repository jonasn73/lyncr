// Telnyx SMS to the locksmith technician when a job is assigned to them.

import {
  isReasonablePstnDialString,
  listFieldTechnicians,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

export type TechJobAssignedSmsData = {
  vehicleYear: string | null
  vehicleMake: string | null
  vehicleModel: string | null
  isAkl: boolean
  location: string | null
  tiSku: string | null
}

/** Build the technician assignment text (vehicle + AKL + address + required TI part). */
export function buildTechJobAssignedSms(data: TechJobAssignedSmsData): string {
  const vehicle = [data.vehicleYear, data.vehicleMake, data.vehicleModel]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ")
  const vehicleLine = vehicle
    ? data.isAkl
      ? `${vehicle} (AKL)`
      : vehicle
    : data.isAkl
      ? "Vehicle (AKL)"
      : "Vehicle"
  const location = data.location?.trim() || "Address TBD"
  const part = data.tiSku?.trim().toUpperCase() || "TBD"

  return [
    `🛠️ JOB ASSIGNED: ${vehicleLine}`,
    `📍 Location: ${location}`,
    `🔑 REQUIRED PART: ${part}`,
  ].join("\n")
}

function pickCollected(collected: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = collected[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function isAklFromCollected(collected: Record<string, unknown>): boolean {
  if (collected.all_keys_lost === true || collected.all_keys_lost === "true") return true
  const serviceType = String(collected.service_quote_type_id ?? "").trim().toLowerCase()
  if (serviceType === "key_gen") return true
  const jobType = String(collected.job_type ?? collected.summary ?? "").toLowerCase()
  return /\bakl\b|all keys lost|key generation/.test(jobType)
}

/**
 * Text the assigned technician the job details + required TI SKU.
 * Safe no-op when the tech has no phone or the lead is missing.
 */
export async function sendTechJobAssignedSms(params: {
  ownerUserId: string
  leadId: string
  techUserId: string
}): Promise<{ ok: true; to: string } | { ok: false; reason: string }> {
  const roster = await listFieldTechnicians(params.ownerUserId)
  const tech = roster.find((row) => row.portal_user_id === params.techUserId && row.is_active)
  const toE164 = tech?.phone ? normalizePhoneNumberE164(tech.phone) : ""
  if (!isReasonablePstnDialString(toE164)) {
    return { ok: false, reason: "no-tech-phone" }
  }

  const sql = neon(resolveNeonDatabaseUrl())
  const rows = await sql`
    SELECT user_id, collected, summary FROM ai_leads
    WHERE id = ${params.leadId} AND user_id = ${params.ownerUserId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return { ok: false, reason: "lead-not-found" }

  const collected = (row.collected as Record<string, unknown>) || {}
  if (row.summary != null && collected.summary == null) {
    collected.summary = String(row.summary)
  }

  const text = buildTechJobAssignedSms({
    vehicleYear: pickCollected(collected, ["vehicle_year", "year"]),
    vehicleMake: pickCollected(collected, ["vehicle_make", "make"]),
    vehicleModel: pickCollected(collected, ["vehicle_model", "model"]),
    isAkl: isAklFromCollected(collected),
    location: pickCollected(collected, [
      "job_address",
      "location",
      "service_address",
      "address_line1",
    ]),
    tiSku: pickCollected(collected, ["ti_sku", "tiSku", "supplier_sku", "required_part"]),
  })

  try {
    const sent = await sendTelnyxSms({
      toE164,
      text,
      userId: params.ownerUserId,
    })
    if (!sent.ok) {
      console.warn("[tech-job-assigned-sms] send failed:", sent.error)
      return { ok: false, reason: sent.error }
    }
    return { ok: true, to: toE164 }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error("[tech-job-assigned-sms] unexpected failure:", detail)
    return { ok: false, reason: detail }
  }
}
