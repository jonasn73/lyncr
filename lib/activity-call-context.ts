// Build human-readable intake + scheduling context for Live Activity rows.

import { UNASSIGNED_POOL_STATUS } from "@/lib/job-pool"
import type { CallActivityContext } from "@/lib/types"

type LeadActivityRow = {
  id: string
  caller_e164: string
  collected: Record<string, unknown>
  summary: string | null
  job_status: string | null
  dispatch_status: string | null
  disposition: string | null
  scheduled_at: string | null
  assigned_tech_name: string | null
  created_at: string
  call_log_id: string | null
}

function pickCollected(collected: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = collected[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function vehicleLineFromCollected(collected: Record<string, unknown>): string | null {
  const parts = [
    pickCollected(collected, ["vehicle_year", "year"]),
    pickCollected(collected, ["vehicle_make", "make"]),
    pickCollected(collected, ["vehicle_model", "model"]),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" ") : null
}

/** Pretty label for a scheduled timestamp. */
export function formatActivityScheduleLabel(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const day = date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return `${day} · ${time}`
}

function scheduleLabelForLead(lead: LeadActivityRow): string | null {
  const scheduledAt = lead.scheduled_at ?? pickCollected(lead.collected, ["scheduled_at", "preferred_time"])
  if (scheduledAt) {
    const label = formatActivityScheduleLabel(scheduledAt)
    const tech = lead.assigned_tech_name?.trim()
    if (label && tech) return `${label} · ${tech}`
    return label
  }
  const dispatch = (lead.dispatch_status ?? pickCollected(lead.collected, ["dispatch_status"]) ?? "").trim()
  const jobStatus = (lead.job_status ?? pickCollected(lead.collected, ["job_status"]) ?? "").trim()
  if (dispatch === UNASSIGNED_POOL_STATUS || jobStatus === "UNASSIGNED") {
    return "In dispatch pool · not scheduled yet"
  }
  return null
}

function intakeDetailForLead(lead: LeadActivityRow): string | null {
  const jobType = pickCollected(lead.collected, ["job_type", "service_type"])
  const vehicle = vehicleLineFromCollected(lead.collected)
  const address = pickCollected(lead.collected, ["job_address", "location", "service_address", "address_line1"])
  const parts = [jobType, vehicle, address].filter(Boolean)
  if (parts.length > 0) return parts.slice(0, 2).join(" · ")
  return lead.summary?.trim() || null
}

function intakeActionForLead(lead: LeadActivityRow, callDisposition: string | null): string {
  const source = pickCollected(lead.collected, ["source"])
  if (source === "answered_call_intake") return "Sent to dispatch"
  const disposition = (lead.disposition ?? pickCollected(lead.collected, ["disposition"]) ?? callDisposition ?? "")
    .trim()
    .toUpperCase()
  if (disposition === "BOOKED") return "Booked"
  if (disposition === "PENDING_TIME") return "Pending time"
  if (disposition === "PRICE_REJECTED") return "Price rejected"
  if (disposition === "FAILED") return "Failed"
  return "Job created"
}

function emptyContext(): CallActivityContext {
  return {
    intakeAction: "No intake recorded",
    intakeDetail: null,
    scheduleLabel: null,
    scheduleAt: null,
    leadId: null,
    callerScheduleHint: null,
    callerPoolCount: 0,
  }
}

function leadFromRow(row: Record<string, unknown>): LeadActivityRow {
  const collected = (row.collected as Record<string, unknown>) || {}
  const scheduledRaw = row.scheduled_at
  const scheduledAt =
    scheduledRaw instanceof Date
      ? scheduledRaw.toISOString()
      : scheduledRaw != null && String(scheduledRaw).trim()
        ? String(scheduledRaw)
        : null
  return {
    id: String(row.id),
    caller_e164: String(row.caller_e164 ?? ""),
    collected,
    summary: row.summary != null ? String(row.summary) : null,
    job_status: row.job_status != null ? String(row.job_status) : null,
    dispatch_status: row.dispatch_status != null ? String(row.dispatch_status) : null,
    disposition: row.disposition != null ? String(row.disposition) : null,
    scheduled_at: scheduledAt,
    assigned_tech_name: row.assigned_tech_name != null ? String(row.assigned_tech_name) : null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    call_log_id: pickCollected(collected, ["call_log_id"]),
  }
}

function isPoolLead(lead: LeadActivityRow): boolean {
  const dispatch = (lead.dispatch_status ?? pickCollected(lead.collected, ["dispatch_status"]) ?? "").trim()
  const jobStatus = (lead.job_status ?? pickCollected(lead.collected, ["job_status"]) ?? "").trim()
  return dispatch === UNASSIGNED_POOL_STATUS || jobStatus === "UNASSIGNED"
}

function isFutureScheduled(lead: LeadActivityRow): boolean {
  const iso = lead.scheduled_at ?? pickCollected(lead.collected, ["scheduled_at", "preferred_time"])
  if (!iso) return false
  const date = new Date(iso)
  return !Number.isNaN(date.getTime()) && date.getTime() >= Date.now() - 15 * 60_000
}

/** Map call log ids → intake/scheduling context for the Activity feed. */
export function buildCallActivityContextMap(params: {
  calls: { id: string; from_number: string; disposition?: string | null }[]
  leadRows: Record<string, unknown>[]
  customerCallLogIds: Set<string>
  phoneE164ByCallId: Map<string, string>
}): Map<string, CallActivityContext> {
  const leads = params.leadRows.map(leadFromRow)
  const leadsByCallLogId = new Map<string, LeadActivityRow>()
  for (const lead of leads) {
    if (!lead.call_log_id) continue
    if (!leadsByCallLogId.has(lead.call_log_id)) {
      leadsByCallLogId.set(lead.call_log_id, lead)
    }
  }

  const leadsByPhone = new Map<string, LeadActivityRow[]>()
  for (const lead of leads) {
    const phone = lead.caller_e164.trim()
    if (!phone) continue
    const list = leadsByPhone.get(phone) ?? []
    list.push(lead)
    leadsByPhone.set(phone, list)
  }

  const result = new Map<string, CallActivityContext>()

  for (const call of params.calls) {
    const linkedLead = leadsByCallLogId.get(call.id)
    const phone = params.phoneE164ByCallId.get(call.id) ?? call.from_number
    const phoneLeads = leadsByPhone.get(phone) ?? []

    if (linkedLead) {
      const scheduleLabel = scheduleLabelForLead(linkedLead)
      const scheduleAt =
        linkedLead.scheduled_at ?? pickCollected(linkedLead.collected, ["scheduled_at", "preferred_time"])
      result.set(call.id, {
        intakeAction: intakeActionForLead(linkedLead, call.disposition ?? null),
        intakeDetail: intakeDetailForLead(linkedLead),
        scheduleLabel,
        scheduleAt: scheduleAt ?? null,
        leadId: linkedLead.id,
        callerScheduleHint: buildCallerScheduleHint(phoneLeads, linkedLead.id),
        callerPoolCount: phoneLeads.filter(isPoolLead).length,
      })
      continue
    }

    if (params.customerCallLogIds.has(call.id)) {
      result.set(call.id, {
        intakeAction: "Contact saved",
        intakeDetail: "Caller details saved from answered panel — not sent to dispatch yet",
        scheduleLabel: null,
        scheduleAt: null,
        leadId: null,
        callerScheduleHint: buildCallerScheduleHint(phoneLeads, null),
        callerPoolCount: phoneLeads.filter(isPoolLead).length,
      })
      continue
    }

    const disposition = (call.disposition ?? "").trim().toUpperCase()
    if (disposition === "BOOKED") {
      result.set(call.id, {
        intakeAction: "Booked",
        intakeDetail: null,
        scheduleLabel: null,
        scheduleAt: null,
        leadId: null,
        callerScheduleHint: buildCallerScheduleHint(phoneLeads, null),
        callerPoolCount: phoneLeads.filter(isPoolLead).length,
      })
      continue
    }
    if (disposition === "PENDING_TIME") {
      result.set(call.id, {
        intakeAction: "Pending time",
        intakeDetail: "Operator marked pending time — follow up to schedule",
        scheduleLabel: null,
        scheduleAt: null,
        leadId: null,
        callerScheduleHint: buildCallerScheduleHint(phoneLeads, null),
        callerPoolCount: phoneLeads.filter(isPoolLead).length,
      })
      continue
    }
    if (disposition === "PRICE_REJECTED") {
      result.set(call.id, {
        intakeAction: "Price rejected",
        intakeDetail: "Lead salvage — customer declined price",
        scheduleLabel: null,
        scheduleAt: null,
        leadId: null,
        callerScheduleHint: buildCallerScheduleHint(phoneLeads, null),
        callerPoolCount: phoneLeads.filter(isPoolLead).length,
      })
      continue
    }
    if (disposition === "FAILED") {
      result.set(call.id, {
        intakeAction: "Failed",
        intakeDetail: "Operator marked call as failed",
        scheduleLabel: null,
        scheduleAt: null,
        leadId: null,
        callerScheduleHint: buildCallerScheduleHint(phoneLeads, null),
        callerPoolCount: phoneLeads.filter(isPoolLead).length,
      })
      continue
    }

    const hint = buildCallerScheduleHint(phoneLeads, null)
    const poolCount = phoneLeads.filter(isPoolLead).length
    if (hint || poolCount > 0) {
      result.set(call.id, {
        ...emptyContext(),
        callerScheduleHint: hint,
        callerPoolCount: poolCount,
      })
      continue
    }

    result.set(call.id, emptyContext())
  }

  return result
}

function buildCallerScheduleHint(phoneLeads: LeadActivityRow[], excludeLeadId: string | null): string | null {
  const upcoming = phoneLeads
    .filter((lead) => lead.id !== excludeLeadId)
    .filter(isFutureScheduled)
    .sort((a, b) => {
      const aIso = a.scheduled_at ?? pickCollected(a.collected, ["scheduled_at"]) ?? ""
      const bIso = b.scheduled_at ?? pickCollected(b.collected, ["scheduled_at"]) ?? ""
      return new Date(aIso).getTime() - new Date(bIso).getTime()
    })[0]

  if (upcoming) {
    const label = formatActivityScheduleLabel(
      upcoming.scheduled_at ?? pickCollected(upcoming.collected, ["scheduled_at", "preferred_time"])
    )
    if (label) return `This number also has ${label}`
  }

  const poolCount = phoneLeads.filter((lead) => lead.id !== excludeLeadId).filter(isPoolLead).length
  if (poolCount > 0) {
    return `${poolCount} open dispatch job${poolCount === 1 ? "" : "s"} for this number`
  }

  return null
}
