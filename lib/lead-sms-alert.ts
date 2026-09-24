// Build the instant SMS alert body sent to business owners after AI intake.

import { SITE_NAME } from "@/lib/brand"

function brandLabel(): string {
  const name = SITE_NAME.trim()
  if (!name) return "Lyncr"
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function readCollectedString(collected: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = collected[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return "—"
}

function formatVehicleLine(collected: Record<string, unknown>): string {
  const year = readCollectedString(collected, ["vehicle_year", "year"])
  const make = readCollectedString(collected, ["vehicle_make", "make"])
  const model = readCollectedString(collected, ["vehicle_model", "model"])
  const combined = readCollectedString(collected, ["vehicle", "year_make_model"])
  if (combined !== "—") return combined
  const parts = [year, make, model].filter((p) => p !== "—")
  return parts.length ? parts.join(" ") : "—"
}

function formatServiceType(intentSlug: string | null, collected: Record<string, unknown>): string {
  const explicit = readCollectedString(collected, [
    "service_type",
    "intent_label",
    "issue_type",
    "request_type",
  ])
  if (explicit !== "—") return explicit
  if (intentSlug?.trim()) {
    return intentSlug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return "General inquiry"
}

function formatLeadStatus(collected: Record<string, unknown>, summary: string | null): string {
  if (collected.callback_requested === true) return "Callback requested"
  if (summary?.startsWith("Caller on hold —")) return "Waiting on hold"
  const status = readCollectedString(collected, ["status", "urgency", "key_status", "priority"])
  if (status !== "—") {
    if (status.toLowerCase() === "asap") return "ASAP"
    if (status.toLowerCase() === "window") return "—"
    return status
  }
  return "—"
}

function formatNotes(collected: Record<string, unknown>, summary: string | null, serviceType: string): string {
  const notes = readCollectedString(collected, ["customer_notes", "notes", "job_notes", "issue_summary", "summary", "details"])
  if (notes !== "—") return notes
  const fallback = summary?.trim() || ""
  if (
    !fallback ||
    fallback.startsWith("Caller on hold —") ||
    fallback.startsWith("Customer submitted book form") ||
    fallback === serviceType ||
    fallback.startsWith(`${serviceType} —`)
  ) return "—"
  return fallback
}

function formatCallerNumber(callerE164: string | null, collected: Record<string, unknown>): string {
  const fromCollected = readCollectedString(collected, [
    "callback_number",
    "caller_number",
    "phone",
    "callback",
  ])
  if (fromCollected !== "—") return fromCollected
  return callerE164?.trim() || "Unknown"
}

/** Compose the owner SMS alert text for a saved intake lead. */
export function buildLeadAlertSmsText(params: {
  businessName: string
  callerE164: string | null
  intentSlug: string | null
  collected: Record<string, unknown>
  summary: string | null
}): string {
  const business = params.businessName.trim() || "Your business"
  const customer = formatCallerNumber(params.callerE164, params.collected)
  const vehicle = formatVehicleLine(params.collected)
  const serviceType = formatServiceType(params.intentSlug, params.collected)
  const status = formatLeadStatus(params.collected, params.summary)
  const notes = formatNotes(params.collected, params.summary, serviceType)
  const name = readCollectedString(params.collected, ["customer_name", "name"])
  const address = readCollectedString(params.collected, ["job_address", "service_address", "address_line1", "address"])
  const zip = readCollectedString(params.collected, ["job_address_postal_code", "postal_code", "zip_code"])
  const email = readCollectedString(params.collected, ["customer_email", "email"])
  const availability = readCollectedString(params.collected, ["availability_label", "availability", "preferred_window"])

  return [
    `🔔 ${brandLabel()} Lead`,
    `Business: ${business}`,
    `Caller: ${customer}`,
    ...(name !== "—" ? [`Name: ${name}`] : []),
    `Service: ${serviceType}`,
    ...(vehicle !== "—" ? [`Vehicle: ${vehicle}`] : []),
    ...(address !== "—" ? [`Address: ${address}`] : []),
    ...(zip !== "—" ? [`ZIP: ${zip}`] : []),
    ...(status !== "—" ? [`Status: ${status}`] : []),
    ...(availability !== "—" ? [`Availability: ${availability}`] : []),
    ...(email !== "—" ? [`Email: ${email}`] : []),
    ...(notes !== "—" ? [`Notes: ${notes}`] : []),
    `Open ${brandLabel()} Leads to respond.`,
  ].join("\n")
}
