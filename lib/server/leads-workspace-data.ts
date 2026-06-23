import { listAiLeadsForUser, listSalvageableLeads } from "@/lib/db"
import type { LeadsWorkspaceCache } from "@/lib/leads-cache"

/** Server payload for /dashboard/leads — matches client session cache shape. */
export async function loadLeadsWorkspaceData(userId: string): Promise<LeadsWorkspaceCache> {
  const [leads, salvageRows] = await Promise.all([
    listAiLeadsForUser(userId, 50),
    listSalvageableLeads(userId, 25),
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
    salvageLeads: salvageRows.map(({ id, caller_e164, summary, collected, created_at }) => ({
      id,
      caller_e164,
      summary,
      collected,
      created_at,
    })),
  }
}
