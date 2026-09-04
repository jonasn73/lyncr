"use client"

import { useMemo } from "react"
import useSWR from "swr"
import type { ActivePipelineJob, UnassignedPoolJob } from "@/lib/types"
import { normalizeWorkspaceOrgId } from "@/lib/workspace-org-id"
import { isTransientWorkspaceOrgStub, organizationQueryString } from "@/lib/workspace-organizations"
import { defaultSwrConfig } from "@/lib/swr/config"
import { swrJsonFetcher } from "@/lib/swr/fetcher"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"
import { useSessionCacheReady } from "@/components/session-cache-hydration-gate"
import {
  mapPoolPaintToJobs,
  readMapPoolPaintSeed,
  readMapPoolPlaceIndex,
  writeMapPoolPaintSeed,
} from "@/lib/map-pool-paint-cache"

type PoolResponse<T> = { data?: { jobs?: T[] } }

const EMPTY_POOL_JOBS: UnassignedPoolJob[] = []
const EMPTY_PIPELINE_JOBS: ActivePipelineJob[] = []

/** Real Neon org id — never fetch pool/pipeline under paint-seed / legacy stubs. */
function resolvePoolOrgId(activeOrganizationId: string | null | undefined): string | null {
  return normalizeWorkspaceOrgId(activeOrganizationId)
}

function jobPoolHopperUrl(activeOrganizationId: string | null): string {
  const orgQs = organizationQueryString(activeOrganizationId)
  return `/api/owner/jobs/pool${orgQs}`
}

function jobPoolActiveUrl(activeOrganizationId: string | null, dayKey: string): string {
  const orgQs = organizationQueryString(activeOrganizationId)
  const sep = orgQs ? "&" : "?"
  return `/api/owner/jobs/pool${orgQs}${sep}scope=active&day=${encodeURIComponent(dayKey)}`
}

/** Bust SWR caches for hopper + active pipeline lists (call after intake saves). */
export async function revalidateSchedulerJobPoolCaches(
  activeOrganizationId?: string | null
): Promise<void> {
  const { mutate: globalMutate } = await import("swr")
  const hopperUrl = jobPoolHopperUrl(activeOrganizationId ?? null)
  await Promise.all([
    globalMutate(hopperUrl, undefined, { revalidate: true }),
    globalMutate(
      (key) =>
        typeof key === "string" &&
        key.startsWith("/api/owner/jobs/pool") &&
        key.includes("scope=active"),
      undefined,
      { revalidate: true }
    ),
  ])
}

/** Immediately drop a deleted job from hopper + active pipeline caches, then revalidate. */
export async function optimisticRemovePoolJob(
  activeOrganizationId: string | null,
  dayKey: string,
  jobId: string
): Promise<void> {
  const { mutate: globalMutate } = await import("swr")
  const orgKey = activeOrganizationId ?? "default"
  const hopperUrl = jobPoolHopperUrl(activeOrganizationId)
  const pipelineUrl = jobPoolActiveUrl(activeOrganizationId, dayKey)
  const hopperCache = persistedCacheKey("job-pool-hopper", orgKey)
  const pipelineCache = persistedCacheKey("job-pool-active", `${orgKey}:${dayKey}`)

  const withoutId = <T extends { id: string }>(list: T[] | undefined): T[] =>
    Array.isArray(list) ? list.filter((row) => row.id !== jobId) : []

  await Promise.all([
    globalMutate(
      hopperUrl,
      (current) => {
        const next = withoutId(current as UnassignedPoolJob[] | undefined)
        writePersistedCache(hopperCache, next)
        return next
      },
      { revalidate: true, populateCache: true }
    ),
    globalMutate(
      pipelineUrl,
      (current) => {
        const next = withoutId(current as ActivePipelineJob[] | undefined)
        writePersistedCache(pipelineCache, next)
        return next
      },
      { revalidate: true, populateCache: true }
    ),
  ])
}

export function useJobPoolQuery(
  activeOrganizationId: string | null,
  /** Pause hopper fetches when Scheduler/Map pane is hidden. Default true. */
  enabled = true
) {
  const orgId = resolvePoolOrgId(activeOrganizationId)
  // A "__" placeholder means a real org id is still being resolved (e.g. mid org-switch) —
  // wait for it so we don't briefly fetch the wrong shop. A "legacy-" id or no id at all
  // both mean "this account's own default" — the API already resolves that via session
  // (see /api/owner/jobs/pool), so there's nothing to wait for; fetch immediately.
  const orgResolving = isTransientWorkspaceOrgStub(activeOrganizationId)
  const url = enabled && !orgResolving ? jobPoolHopperUrl(activeOrganizationId ?? null) : null
  const cacheKey = persistedCacheKey("job-pool-hopper", orgId ?? "default")
  const paintJobs = useDashboardPaintSeeds().mapPool
  const paintSeed = readMapPoolPaintSeed(paintJobs, orgId)
  const sessionReady = useSessionCacheReady()

  // sessionStorage doesn't exist during SSR, so an ungated read here would return a real
  // cached list on the client's first hydration pass but nothing on the server — a real
  // hydration mismatch (React discards and rebuilds the subtree). Gate on sessionReady,
  // same as the paint place-index read below.
  const fallbackData = useMemo(() => {
    if (orgResolving) return undefined
    const fromSession = sessionReady ? readPersistedCache<UnassignedPoolJob[]>(cacheKey) : null
    if (fromSession && fromSession.length > 0) return fromSession
    if (paintSeed?.jobs.length) {
      const places = sessionReady
        ? readMapPoolPlaceIndex(orgId)
        : null
      return mapPoolPaintToJobs(paintSeed, places)
    }
    return undefined
  }, [cacheKey, paintSeed, sessionReady, orgId, orgResolving])

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    url,
    (key: string) =>
      swrJsonFetcher<PoolResponse<UnassignedPoolJob>>(key).then((json) => {
        const jobs = Array.isArray(json.data?.jobs) ? json.data!.jobs! : []
        writePersistedCache(cacheKey, jobs)
        writeMapPoolPaintSeed(jobs, orgId)
        return jobs
      }),
    { ...defaultSwrConfig, fallbackData, revalidateOnFocus: false }
  )

  const hasCachedData =
    data !== undefined || (Array.isArray(fallbackData) && fallbackData.length > 0)
  const jobs = useMemo(() => {
    if (orgResolving) return EMPTY_POOL_JOBS
    if (data !== undefined) return data
    return fallbackData ?? EMPTY_POOL_JOBS
  }, [data, fallbackData, orgResolving])

  return {
    jobs,
    error,
    isLoading: isLoading && !hasCachedData,
    isValidating,
    /** True after SWR resolved (including empty) — gates Pool KPI zeros. */
    hasResolved:
      !orgResolving &&
      (data !== undefined || (Array.isArray(fallbackData) && fallbackData.length > 0)),
    mutate,
  }
}

export function useJobPoolSuspenseQuery(activeOrganizationId: string | null) {
  const url = jobPoolHopperUrl(activeOrganizationId)
  const cacheKey = persistedCacheKey("job-pool-hopper", activeOrganizationId ?? "default")
  const sessionReady = useSessionCacheReady()
  // Same hydration-mismatch guard as useJobPoolQuery — sessionStorage isn't available
  // during SSR, so this must not diverge from the server's render on first hydration.
  const fallbackData = useMemo(
    () => (sessionReady ? readPersistedCache<UnassignedPoolJob[]>(cacheKey) : undefined),
    [cacheKey, sessionReady]
  )
  const { data } = useSWR(
    url,
    (key: string) =>
      swrJsonFetcher<PoolResponse<UnassignedPoolJob>>(key).then((json) => {
        const jobs = Array.isArray(json.data?.jobs) ? json.data!.jobs! : []
        writePersistedCache(cacheKey, jobs)
        return jobs
      }),
    { ...defaultSwrConfig, fallbackData, suspense: true, revalidateOnFocus: false }
  )
  return useMemo(() => data ?? fallbackData ?? EMPTY_POOL_JOBS, [data, fallbackData])
}

export function useActivePipelineQuery(
  activeOrganizationId: string | null,
  dayKey: string,
  enabled = true
) {
  const orgId = resolvePoolOrgId(activeOrganizationId)
  // See useJobPoolQuery above — a "legacy-" id (or no id) means "this account's own
  // default," which the API already resolves via session; only a "__" placeholder means a
  // real org id is still being resolved and worth waiting for.
  const orgResolving = isTransientWorkspaceOrgStub(activeOrganizationId)
  const url = enabled && !orgResolving ? jobPoolActiveUrl(activeOrganizationId ?? null, dayKey) : null
  const cacheKey = persistedCacheKey(
    "job-pool-active",
    `${orgId ?? "default"}:${dayKey}`
  )
  const sessionReady = useSessionCacheReady()

  // Same hydration-mismatch guard as useJobPoolQuery's fallbackData above.
  const fallbackData = useMemo(() => {
    if (orgResolving) return undefined
    const fromSession = sessionReady ? readPersistedCache<ActivePipelineJob[]>(cacheKey) : null
    if (fromSession && fromSession.length > 0) return fromSession
    return undefined
  }, [cacheKey, sessionReady, orgResolving])

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    url,
    (key: string) =>
      swrJsonFetcher<PoolResponse<ActivePipelineJob>>(key).then((json) => {
        const jobs = Array.isArray(json.data?.jobs) ? json.data!.jobs! : []
        writePersistedCache(cacheKey, jobs)
        return jobs
      }),
    { ...defaultSwrConfig, fallbackData, revalidateOnFocus: false }
  )

  const hasCachedData =
    data !== undefined || (Array.isArray(fallbackData) && fallbackData.length > 0)
  const jobs = useMemo(() => {
    if (orgResolving) return EMPTY_PIPELINE_JOBS
    if (data !== undefined) return data
    return fallbackData ?? EMPTY_PIPELINE_JOBS
  }, [data, fallbackData, orgResolving])

  return {
    jobs,
    error,
    isLoading: isLoading && !hasCachedData,
    isValidating,
    /** True after SWR resolved (including empty) — gates “0 active” until then. */
    hasResolved:
      !orgResolving &&
      (data !== undefined || (Array.isArray(fallbackData) && fallbackData.length > 0)),
    mutate,
  }
}

export function useActivePipelineSuspenseQuery(
  activeOrganizationId: string | null,
  dayKey: string,
  enabled = true
) {
  const url = enabled ? jobPoolActiveUrl(activeOrganizationId, dayKey) : null
  const cacheKey = persistedCacheKey(
    "job-pool-active",
    `${activeOrganizationId ?? "default"}:${dayKey}`
  )
  const sessionReady = useSessionCacheReady()
  // Same hydration-mismatch guard as useJobPoolQuery's fallbackData above.
  const fallbackData = useMemo(
    () => (sessionReady ? readPersistedCache<ActivePipelineJob[]>(cacheKey) : undefined),
    [cacheKey, sessionReady]
  )
  const { data } = useSWR(
    url,
    (key: string) =>
      swrJsonFetcher<PoolResponse<ActivePipelineJob>>(key).then((json) => {
        const jobs = Array.isArray(json.data?.jobs) ? json.data!.jobs! : []
        writePersistedCache(cacheKey, jobs)
        return jobs
      }),
    { ...defaultSwrConfig, fallbackData, suspense: true, revalidateOnFocus: false }
  )
  return useMemo(() => data ?? fallbackData ?? EMPTY_PIPELINE_JOBS, [data, fallbackData])
}
