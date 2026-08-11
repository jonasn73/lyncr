/**
 * CRM helpers for walk-up Collect charges that never got an ai_leads row.
 * Used so Service history is not empty when Payments / LTV already show money.
 */

import type { CrmServiceHistoryItem, CustomerVehicle } from "@/lib/types"
import type { OwnerCollectedTransaction } from "@/lib/owner-collected"

/** Pull "Email: someone@…" from CRM notes (how we store walk-up emails). */
export function emailFromCustomerNotes(notes: string | null | undefined): string {
  // Look for a line like "Email: dieselrepair93@gmail.com"
  const match = String(notes ?? "").match(/Email:\s*([^\s\n]+@[^\s\n]+)/i)
  // Return the address, or "" if notes have no email
  return match?.[1]?.trim() || ""
}

/** Write or replace the CRM "Email: …" notes line used by Send invoice prefills. */
export function notesWithCustomerEmail(
  notes: string | null | undefined,
  email: string | null | undefined
): string {
  // Drop any existing Email: line so we do not stack duplicates
  const withoutEmail = String(notes ?? "")
    .replace(/(^|\n)Email:\s*[^\n]*/gi, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  const trimmed = String(email ?? "").trim().toLowerCase().slice(0, 160)
  // Clearing email leaves other notes alone
  if (!trimmed) return withoutEmail
  // Keep Email: first so emailFromCustomerNotes stays reliable
  return withoutEmail ? `Email: ${trimmed}\n${withoutEmail}` : `Email: ${trimmed}`
}

/** True when this history row is a synthetic walk-up card (not a real ai_leads id). */
export function isWalkUpHistoryId(id: string): boolean {
  // Synthetic ids always start with this prefix so Scheduler nav can skip them
  return id.startsWith("walkup:")
}

/** Best vehicle label for a walk-up card — garage first, then notes "Vehicle: …". */
function walkUpVehicleLabel(
  vehicles: CustomerVehicle[],
  notes: string | null | undefined
): string | null {
  // Prefer the first saved garage vehicle (year make model)
  const v = vehicles[0]
  if (v) {
    const label = [v.year, v.make, v.model].filter(Boolean).join(" ").trim()
    if (label) return label
  }
  // Fall back to a Vehicle: line in CRM notes
  const fromNotes = String(notes ?? "").match(/Vehicle:\s*([^\n]+)/i)
  const trimmed = fromNotes?.[1]?.trim()
  return trimmed || null
}

/** True when notes/payment context looks like All Keys Lost (AKL). */
function notesSuggestAkl(notes: string | null | undefined): boolean {
  // Match common locksmith shorthand in free-text notes
  return /\b(akl|all keys lost)\b/i.test(String(notes ?? ""))
}

/**
 * Build Done-style history cards from completed walk-up payments that have no job_id.
 * Skips charges already linked to a real lead (those show via listCrmServiceHistoryForCustomer).
 */
export function walkUpHistoryFromPayments(params: {
  payments: OwnerCollectedTransaction[]
  vehicles: CustomerVehicle[]
  notes?: string | null
}): CrmServiceHistoryItem[] {
  const { payments, vehicles, notes } = params
  // Garage / notes vehicle string reused on every walk-up card
  const vehicleLabel = walkUpVehicleLabel(vehicles, notes)
  // AKL vs generic "Service" from notes (walk-up wallet rows have no job_type column)
  const akl = notesSuggestAkl(notes)

  return payments
    // Only settled charges with no schedule job — those never appear in ai_leads history
    .filter((tx) => tx.status === "COMPLETED" && !tx.jobId)
    .map((tx) => {
      // Dollars on the wallet row → cents for the CRM amount chip
      const amountCents = Math.round(Number(tx.amount) * 100)
      // Short human summary: Walk-up · AKL · 2019 Hino 268
      const summaryParts = [
        "Walk-up",
        akl ? "AKL" : "Service",
        vehicleLabel,
        amountCents > 0 ? `Paid $${(amountCents / 100).toFixed(amountCents % 100 === 0 ? 0 : 2)}` : null,
      ].filter(Boolean)

      const item: CrmServiceHistoryItem = {
        // Prefix keeps this out of Scheduler deep-links
        id: `walkup:${tx.id}`,
        summary: summaryParts.join(" · "),
        status_label: "Paid walk-up",
        status_tone: "emerald",
        assigned_tech_name: null,
        amount_cents: amountCents > 0 ? amountCents : null,
        vehicle_label: vehicleLabel,
        vehicle_year: vehicles[0]?.year ?? null,
        vehicle_make: vehicles[0]?.make ?? null,
        vehicle_model: vehicles[0]?.model ?? null,
        service_quote_type_id: akl ? "key_generation" : null,
        job_type: akl ? "Key Generation (AKL)" : null,
        has_job_address: false,
        at: tx.createdAt,
        scheduled_at: null,
        dispatch_status: "completed",
        is_open_lead: false,
        is_salvageable: false,
        needs_review_sms: false,
      }
      return item
    })
}

/**
 * Merge real ai_leads history with synthetic walk-up cards (newest first).
 * Real jobs win when a payment later gets linked — walk-ups only fill gaps.
 */
export function mergeCrmServiceHistoryWithWalkUps(params: {
  history: CrmServiceHistoryItem[]
  payments: OwnerCollectedTransaction[]
  vehicles: CustomerVehicle[]
  notes?: string | null
}): CrmServiceHistoryItem[] {
  const walkUps = walkUpHistoryFromPayments(params)
  // Nothing to merge — return the DB list as-is
  if (walkUps.length === 0) return params.history
  // Combine then sort by call/pay time descending
  return [...params.history, ...walkUps].sort((a, b) => {
    const ta = new Date(a.at).getTime()
    const tb = new Date(b.at).getTime()
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
  })
}
