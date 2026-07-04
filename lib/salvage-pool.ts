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
  /** True when a receptionist PRICE_REJECTED row was merged with an intake lost_lead same day. */
  has_receptionist_log: boolean
}

function normalizeSalvagePhone(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1)
  return digits
}

/** Local calendar day key for dedupe windows (caller + day). */
function localDateKeyFromIso(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "unknown"
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function salvageDedupeKey(entry: SalvagePoolEntry): string | null {
  const phone = normalizeSalvagePhone(entry.caller_e164)
  if (phone.length < 10) return null
  return `${phone}|${localDateKeyFromIso(entry.created_at)}`
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
    has_receptionist_log: false,
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
    has_receptionist_log: false,
  }
}

/** Merge duplicate salvage rows (same caller + calendar day). Favors lost_lead pricing metadata. */
export function mergeSalvageEntries(primary: SalvagePoolEntry, secondary: SalvagePoolEntry): SalvagePoolEntry {
  const lost = primary.source === "lost_lead" ? primary : secondary.source === "lost_lead" ? secondary : null
  const ai = primary.source === "ai_lead" ? primary : secondary.source === "ai_lead" ? secondary : null
  const base = lost ?? primary
  const other = base === primary ? secondary : primary

  const hasReceptionistLog =
    primary.has_receptionist_log || secondary.has_receptionist_log || Boolean(lost && ai)

  const mergedCollected: Record<string, unknown> = {
    ...(ai?.collected ?? {}),
    ...(lost?.collected ?? {}),
  }
  if (hasReceptionistLog && ai) {
    mergedCollected.receptionist_lead_id = ai.id
  }

  const primaryTime = Date.parse(primary.created_at)
  const secondaryTime = Date.parse(secondary.created_at)
  const newestCreatedAt =
    Number.isFinite(primaryTime) && Number.isFinite(secondaryTime)
      ? primaryTime >= secondaryTime
        ? primary.created_at
        : secondary.created_at
      : base.created_at

  return {
    id: lost?.id ?? base.id,
    source: lost ? "lost_lead" : base.source,
    caller_e164: base.caller_e164 ?? other.caller_e164,
    summary: lost?.summary?.trim() ? lost.summary : base.summary ?? other.summary,
    failure_reason: lost?.failure_reason ?? base.failure_reason ?? other.failure_reason,
    status: lost?.status ?? base.status ?? other.status,
    last_quoted_price_cents:
      lost?.last_quoted_price_cents ?? base.last_quoted_price_cents ?? other.last_quoted_price_cents,
    collected: mergedCollected,
    created_at: newestCreatedAt,
    manual_retry_required: primary.manual_retry_required || secondary.manual_retry_required,
    recovery_blocked_reason:
      primary.recovery_blocked_reason ?? secondary.recovery_blocked_reason ?? null,
    call_log_id: lost?.call_log_id ?? base.call_log_id ?? other.call_log_id ?? ai?.call_log_id ?? null,
    vehicle_label: lost?.vehicle_label ?? base.vehicle_label ?? other.vehicle_label,
    service_type: lost?.service_type ?? base.service_type ?? other.service_type,
    has_receptionist_log: hasReceptionistLog,
  }
}

/** Collapse duplicate caller+day rows after merging ai_leads and lost_leads lists. */
export function dedupeSalvagePoolEntries(entries: SalvagePoolEntry[]): SalvagePoolEntry[] {
  const byKey = new Map<string, SalvagePoolEntry>()

  for (const entry of entries) {
    const key = salvageDedupeKey(entry) ?? `id:${entry.source}:${entry.id}`
    const existing = byKey.get(key)
    byKey.set(key, existing ? mergeSalvageEntries(existing, entry) : entry)
  }

  return [...byKey.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
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

  const merged = dedupeSalvagePoolEntries([...aiEntries, ...lostEntries]).slice(0, limit)

  return {
    entries: merged,
    counts: {
      ai_lead: merged.filter((e) => e.source === "ai_lead").length,
      lost_lead: merged.filter((e) => e.source === "lost_lead").length,
      manual_retry: merged.filter((e) => e.manual_retry_required).length,
    },
  }
}
