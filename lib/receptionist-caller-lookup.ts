// Resolve an inbound caller to their CRM record for the receptionist screen-pop.
//
// Reuses the owner's CRM search rather than adding a second definition of "who is this" —
// the list row already computes jobs completed, lifetime revenue, open leads, and the
// latest job status label, and it is scoped by owner_user_id so a receptionist only ever
// sees the business they are linked to.

import { listCrmCustomersForUser, listCrmServiceHistoryForCustomer } from "@/lib/db"
import { normalizePhoneNumberE164 } from "@/lib/db"
import type { ReceptionistCallerLookup } from "@/lib/types"

export const EMPTY_CALLER_LOOKUP: ReceptionistCallerLookup = {
  found: false,
  customer_id: null,
  display_name: null,
  phone_e164: null,
  city: null,
  region: null,
  jobs_completed: 0,
  lifetime_revenue_cents: 0,
  open_lead_count: 0,
  has_open_book_form: false,
  job_status_label: null,
  job_status_tone: null,
  notes: null,
  last_job_summary: null,
  last_job_vehicle: null,
  last_job_at: null,
}

/** Compare on digits — CRM rows and carrier CNAM disagree on +1 / formatting. */
function digitsOf(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "")
}

/** Last 10 digits, so +15025551234 and 5025551234 match. */
function matchKey(value: string | null | undefined): string {
  const digits = digitsOf(value)
  return digits.length > 10 ? digits.slice(-10) : digits
}

/**
 * Look up a caller under the owner's account.
 *
 * Always resolves — a caller with no record is a normal outcome, not an error, and the
 * screen-pop still has to render in the ~2 seconds before the operator speaks.
 */
export async function lookupReceptionistCaller(
  ownerUserId: string,
  callerNumber: string | null | undefined
): Promise<ReceptionistCallerLookup> {
  const key = matchKey(callerNumber)
  // Fewer than 10 digits cannot identify anyone — short codes, blocked, or malformed.
  if (key.length < 10) return EMPTY_CALLER_LOOKUP

  const e164 = normalizePhoneNumberE164(callerNumber ?? "") || null

  try {
    const matches = await listCrmCustomersForUser(ownerUserId, { q: key, limit: 5 })
    // The search is fuzzy, so confirm the number actually matches before claiming identity —
    // announcing the wrong customer's history is worse than announcing none.
    const hit = matches.find((row) => matchKey(row.phone_e164) === key)
    if (!hit) return { ...EMPTY_CALLER_LOOKUP, phone_e164: e164 }

    // Last job is a bonus on top of an already-confirmed match — never let a hiccup
    // here erase the identity we just found.
    let lastJobSummary: string | null = null
    let lastJobVehicle: string | null = null
    let lastJobAt: string | null = null
    try {
      const [lastJob] = await listCrmServiceHistoryForCustomer({
        userId: ownerUserId,
        customerId: hit.id,
        phoneE164: hit.phone_e164,
        limit: 1,
      })
      if (lastJob) {
        lastJobSummary = lastJob.summary?.trim() || lastJob.job_type?.trim() || null
        lastJobVehicle = lastJob.vehicle_label
        lastJobAt = lastJob.scheduled_at ?? lastJob.at ?? null
      }
    } catch {
      // No history is a normal outcome — leave the fields null.
    }

    return {
      found: true,
      customer_id: hit.id,
      display_name: hit.display_name?.trim() || null,
      phone_e164: hit.phone_e164 || e164,
      city: hit.city?.trim() || null,
      region: hit.region?.trim() || null,
      jobs_completed: Number(hit.jobs_completed ?? 0),
      lifetime_revenue_cents: Number(hit.lifetime_revenue_cents ?? 0),
      open_lead_count: Number(hit.open_lead_count ?? 0),
      has_open_book_form: Boolean(hit.has_book_form_lead),
      job_status_label: hit.job_status_label?.trim() || null,
      job_status_tone: hit.job_status_tone ?? null,
      notes: hit.notes?.trim() || null,
      last_job_summary: lastJobSummary,
      last_job_vehicle: lastJobVehicle,
      last_job_at: lastJobAt,
    }
  } catch {
    // A CRM hiccup must never block the screen-pop or the answer button.
    return { ...EMPTY_CALLER_LOOKUP, phone_e164: e164 }
  }
}
