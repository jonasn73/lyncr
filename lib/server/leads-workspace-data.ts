import { listAiLeadsForDashboard, reconcileMiscategorizedCrmLeads } from "@/lib/db"
import { listUnifiedSalvagePool } from "@/lib/salvage-pool"
import type { LeadsWorkspaceCache } from "@/lib/leads-cache"

/** Server payload for /dashboard/leads — matches client session cache shape. */
export async function loadLeadsWorkspaceData(userId: string): Promise<LeadsWorkspaceCache> {
  await reconcileMiscategorizedCrmLeads(userId)
  const [leads, salvagePool] = await Promise.all([
    listAiLeadsForDashboard(userId, 50),
    listUnifiedSalvagePool(userId, 50),
  ])

  return {
    leads: leads.map(({ id, caller_e164, intent_slug, collected, summary, created_at }) => ({
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
  }
}
