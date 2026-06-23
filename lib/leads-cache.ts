import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

export type CachedLeadRow = {
  id: string
  caller_e164: string | null
  intent_slug: string | null
  collected: Record<string, unknown>
  summary: string | null
  created_at: string
}

export type CachedSalvageLead = {
  id: string
  caller_e164: string | null
  summary: string | null
  collected: Record<string, unknown>
  created_at: string
}

export type LeadsWorkspaceCache = {
  leads: CachedLeadRow[]
  salvageLeads: CachedSalvageLead[]
}

const CACHE_KEY = persistedCacheKey("leads-workspace", "default")

export function readLeadsWorkspaceCache(): LeadsWorkspaceCache | undefined {
  return readPersistedCache<LeadsWorkspaceCache>(CACHE_KEY)
}

export function writeLeadsWorkspaceCache(data: LeadsWorkspaceCache): void {
  writePersistedCache(CACHE_KEY, data)
}

/** Fetch leads + salvage and update session cache — safe to call from prefetch or the Leads tab. */
export async function refreshLeadsWorkspaceCache(): Promise<LeadsWorkspaceCache> {
  const [leadsRes, salvageRes] = await Promise.all([
    fetch("/api/ai-leads", { credentials: "include" }),
    fetch("/api/owner/lead-salvage", { credentials: "include" }),
  ])

  let leads: CachedLeadRow[] = []
  if (leadsRes.ok) {
    const json = (await leadsRes.json()) as { leads?: CachedLeadRow[] }
    leads = Array.isArray(json.leads) ? json.leads : []
  } else if (!leadsRes.ok) {
    throw new Error("Could not load leads")
  }

  let salvageLeads: CachedSalvageLead[] = []
  if (salvageRes.ok) {
    const json = (await salvageRes.json()) as { data?: { leads?: CachedSalvageLead[] } }
    salvageLeads = Array.isArray(json.data?.leads) ? json.data!.leads! : []
  }

  const payload = { leads, salvageLeads }
  writeLeadsWorkspaceCache(payload)
  return payload
}
