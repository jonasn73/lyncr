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
  source?: "ai_lead" | "lost_lead"
  caller_e164: string | null
  summary: string | null
  collected: Record<string, unknown>
  created_at: string
  status?: string | null
  failure_reason?: string | null
  last_quoted_price_cents?: number | null
  manual_retry_required?: boolean
  recovery_blocked_reason?: string | null
  has_receptionist_log?: boolean
}

export type LeadsWorkspaceCache = {
  leads: CachedLeadRow[]
  salvageLeads: CachedSalvageLead[]
}

const CACHE_KEY = persistedCacheKey("leads-workspace", "default")

/** Stable snapshot for useSyncExternalStore — same sessionStorage string → same object reference. */
let leadsCacheSnapshotRaw: string | null | undefined
let leadsCacheSnapshotData: LeadsWorkspaceCache | undefined

const leadsCacheListeners = new Set<() => void>()

function notifyLeadsCacheListeners(): void {
  leadsCacheSnapshotRaw = undefined
  leadsCacheListeners.forEach((listener) => listener())
}

export function subscribeLeadsWorkspaceCache(onStoreChange: () => void): () => void {
  leadsCacheListeners.add(onStoreChange)
  return () => {
    leadsCacheListeners.delete(onStoreChange)
  }
}

export function getLeadsWorkspaceCacheSnapshot(): LeadsWorkspaceCache | undefined {
  if (typeof window === "undefined") return undefined
  let raw: string | null
  try {
    raw = sessionStorage.getItem(CACHE_KEY)
  } catch {
    return undefined
  }
  if (raw === leadsCacheSnapshotRaw) {
    return leadsCacheSnapshotData
  }
  leadsCacheSnapshotRaw = raw
  leadsCacheSnapshotData = raw ? readPersistedCache<LeadsWorkspaceCache>(CACHE_KEY) : undefined
  return leadsCacheSnapshotData
}

export function readLeadsWorkspaceCache(): LeadsWorkspaceCache | undefined {
  return readPersistedCache<LeadsWorkspaceCache>(CACHE_KEY)
}

export function writeLeadsWorkspaceCache(data: LeadsWorkspaceCache): void {
  writePersistedCache(CACHE_KEY, data)
  notifyLeadsCacheListeners()
}

/** Fetch leads + salvage and update session cache — safe to call from prefetch or the Leads tab. */
export async function refreshLeadsWorkspaceCache(): Promise<LeadsWorkspaceCache> {
  const [leadsRes, salvageRes] = await Promise.all([
    fetch("/api/ai-leads", { credentials: "include" }),
    fetch("/api/leads/salvage-pool", { credentials: "include" }),
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
    const json = (await salvageRes.json()) as {
      data?: { leads?: CachedSalvageLead[]; entries?: CachedSalvageLead[] }
    }
    salvageLeads = Array.isArray(json.data?.leads)
      ? json.data!.leads!
      : Array.isArray(json.data?.entries)
        ? json.data!.entries!
        : []
  }

  const payload = { leads, salvageLeads }
  writeLeadsWorkspaceCache(payload)
  return payload
}
