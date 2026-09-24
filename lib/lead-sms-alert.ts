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

function formatKeyStatus(collected: Record<string, unknown>, summary: string | null): string {
  const status = readCollectedString(collected, ["status", "urgency", "key_status", "priority"])
  if (status !== "—") {
    if (status.toLowerCase() === "asap") return "ASAP"
    if (status.toLowerCase() === "window") return "Preferred window"
    return status
  }
  if (summary?.trim()) {
    const firstSentence = summary.trim().split(/[.!?]/)[0]?.trim()
    if (firstSentence) return firstSentence.slice(0, 120)
  }
  return "New lead captured"
}

function formatNotes(collected: Record<string, unknown>, summary: string | null): string {
  const notes = readCollectedString(collected, ["customer_notes", "notes", "job_notes", "issue_summary", "summary", "details"])
  if (notes !== "—") return notes
  return summary?.trim() || "—"
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
  const status = formatKeyStatus(params.collected, params.summary)
  const notes = formatNotes(params.collected, params.summary)
  const name = readCollectedString(params.collected, ["customer_name", "name"])
  const address = readCollectedString(params.collected, ["job_address", "service_address", "address_line1", "address"])
  const email = readCollectedString(params.collected, ["customer_email", "email"])
  const availability = readCollectedString(params.collected, ["availability_label", "availability", "preferred_window"])

  return [
    `⚡ ${brandLabel()} New Lead Alert ⚡`,
    `Business: ${business}`,
    `Customer: ${customer}`,
    ...(name !== "—" ? [`Name: ${name}`] : []),
    "Details:",
    `- Vehicle: ${vehicle}`,
    `- Type: ${serviceType}`,
    `- Status: ${status}`,
    ...(address !== "—" ? [`- Address: ${address}`] : []),
    ...(availability !== "—" ? [`- Availability: ${availability}`] : []),
    ...(email !== "—" ? [`- Email: ${email}`] : []),
    `Notes: ${notes}`,
    `View full breakdown in your ${brandLabel()} panel.`,
  ].join("\n")
}
