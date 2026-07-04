// Unified lead-salvage pool — merges ai_leads PRICE_REJECTED + lost_leads intake rows.

import { listSalvageableLeads } from "@/lib/db"
import { listLostLeadsForSalvagePool, type LostLeadRow } from "@/lib/lost-leads"

export type SalvagePoolSource = "ai_lead" | "lost_lead"

/** Normalized row for the owner salvage dashboard and GET /api/leads/salvage-pool. */
export type SalvagePoolEntry = {
  id: string
  source: SalvagePoolSource
  caller_e164: string | null
  summary: string | null
  failure_reason: string | null
  status: string | null
  last_quoted_price_cents: number | null
  collected: Record<string, unknown>
  created_at: string
  /** True when automated recovery SMS was blocked (e.g. missing 10DLC). */
  manual_retry_required: boolean
  recovery_blocked_reason: string | null
  call_log_id: string | null
  vehicle_label: string | null
  service_type: string | null
}

function vehicleLabelFromLost(row: LostLeadRow): string | null {
  const parts = [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean)
  return parts.length ? parts.join(" ") : null
}

function lostLeadToSalvageEntry(row: LostLeadRow): SalvagePoolEntry {
  const manualRetry = row.status === "failed_10dlc"
  return {
    id: row.id,
    source: "lost_lead",
    caller_e164: row.phone_number,
    summary:
      [row.service_type, row.failure_reason].filter(Boolean).join(" · ") ||
      "Intake lost lead — follow up to recover.",
    failure_reason: row.failure_reason,
    status: row.status,
    last_quoted_price_cents: row.last_quoted_price_cents,
    collected: row.collected ?? {},
    created_at: row.created_at,
    manual_retry_required: manualRetry,
    recovery_blocked_reason: manualRetry ? row.recovery_sms_error : null,
    call_log_id: row.call_log_id,
    vehicle_label: vehicleLabelFromLost(row),
    service_type: row.service_type,
  }
}

function aiLeadToSalvageEntry(lead: {
  id: string
  caller_e164: string | null
  summary: string | null
  collected: Record<string, unknown>
  created_at: string
}): SalvagePoolEntry {
  return {
    id: lead.id,
    source: "ai_lead",
    caller_e164: lead.caller_e164,
    summary: lead.summary,
    failure_reason: "Price rejected",
    status: "PRICE_REJECTED",
    last_quoted_price_cents: null,
    collected: lead.collected ?? {},
    created_at: lead.created_at,
    manual_retry_required: false,
    recovery_blocked_reason: null,
    call_log_id:
      typeof lead.collected?.call_log_id === "string" ? String(lead.collected.call_log_id) : null,
    vehicle_label: null,
    service_type: null,
  }
}

/** Concurrent lookup across ai_leads salvage queue + lost_leads rescue rows. */
export async function listUnifiedSalvagePool(
  ownerUserId: string,
  limit = 50
): Promise<{ entries: SalvagePoolEntry[]; counts: { ai_lead: number; lost_lead: number; manual_retry: number } }> {
  const perSource = Math.min(Math.max(Math.ceil(limit / 2), 10), 100)

  const [aiRows, lostRows] = await Promise.all([
    listSalvageableLeads(ownerUserId, perSource),
    listLostLeadsForSalvagePool(ownerUserId, perSource),
  ])

  const aiEntries = aiRows.map(aiLeadToSalvageEntry)
  const lostEntries = lostRows.map(lostLeadToSalvageEntry)

  const merged = [...aiEntries, ...lostEntries]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, limit)

  return {
    entries: merged,
    counts: {
      ai_lead: aiEntries.length,
      lost_lead: lostEntries.length,
      manual_retry: merged.filter((e) => e.manual_retry_required).length,
    },
  }
}
