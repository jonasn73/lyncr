import { debugListAllAiLeadsForUser, reconcileMiscategorizedCrmLeads } from "@/lib/db"
import { listUnifiedSalvagePool } from "@/lib/salvage-pool"
import type { LeadsWorkspaceCache } from "@/lib/leads-cache"

/** Server payload for /dashboard/leads — matches client session cache shape. */
export async function loadLeadsWorkspaceData(userId: string): Promise<LeadsWorkspaceCache> {
  await reconcileMiscategorizedCrmLeads(userId)
  const [debugPack, salvagePool] = await Promise.all([
    debugListAllAiLeadsForUser(userId, 50),
    listUnifiedSalvagePool(userId, 50),
  ])

  return {
    leads: debugPack.rows.map(({ id, caller_e164, intent_slug, collected, summary, created_at }) => ({
      id,
      caller_e164,
      intent_slug,
      collected,
      summary,
      created_at,
    })),
    salvageLeads: salvagePool.entries.map((e) => ({
      id: e.id,
      source: e.source,
      caller_e164: e.caller_e164,
      summary: e.summary,
      collected: e.collected,
      created_at: e.created_at,
      status: e.status,
      failure_reason: e.failure_reason,
      last_quoted_price_cents: e.last_quoted_price_cents,
      manual_retry_required: e.manual_retry_required,
      recovery_blocked_reason: e.recovery_blocked_reason,
      has_receptionist_log: e.has_receptionist_log,
    })),
    _debug: {
      authUserId: userId,
      totalRowsForUser: debugPack.stats.totalRowsForUser,
      rowsWithOrganizationId: debugPack.stats.rowsWithOrganizationId,
      rowsWithoutOrganizationId: debugPack.stats.rowsWithoutOrganizationId,
      rawLeadCount: debugPack.rows.length,
      filteredLeadCount: debugPack.filteredCount,
      orgFilterNote:
        "SSR load uses user_id only — NOT organization_id. NULL org_id rows still match.",
      sampleRows: debugPack.rows.slice(0, 8).map((row) => ({
        id: row.id,
        user_id: row.user_id,
        organization_id: row.organization_id,
        dispatch_status: row.dispatch_status,
        disposition: row.disposition,
        job_status: row.job_status,
        collected_dispatch_status: row.collected_dispatch_status,
        pending_callback: row.pending_callback,
      })),
      salvageCount: salvagePool.entries.length,
    },
  }
}
