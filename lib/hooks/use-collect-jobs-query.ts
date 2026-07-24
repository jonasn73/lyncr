"use client"

// Fast Collect Payment job list: SWR + session cache so “Today’s jobs” rarely spins.

import { useMemo } from "react"
import useSWR, { mutate as globalMutate } from "swr"
import type { DispatchJob } from "@/lib/types"
import { defaultSwrConfig } from "@/lib/swr/config"
import { swrJsonFetcher } from "@/lib/swr/fetcher"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

/** Lightweight jobs-only API (no tech GPS). */
export const COLLECT_JOBS_URL = "/api/owner/jobs?scope=collect"

type JobsResponse = { data?: { jobs?: DispatchJob[] } }

const EMPTY: DispatchJob[] = []

function cacheKey(): string {
  return persistedCacheKey("collect-jobs", "default")
}

/** Keep open / in-progress jobs for the Collect list. */
function filterCollectJobs(list: DispatchJob[]): DispatchJob[] {
  const openJobs = list.filter((job) => {
    const s = (job.job_status ?? "").toLowerCase()
    return s !== "completed" && s !== "cancelled" && s !== "canceled"
  })
  return openJobs.length ? openJobs : list.slice(0, 12)
}

async function fetchCollectJobs(): Promise<DispatchJob[]> {
  const json = await swrJsonFetcher<JobsResponse>(COLLECT_JOBS_URL)
  const list = Array.isArray(json.data?.jobs) ? json.data!.jobs! : []
  const next = filterCollectJobs(list)
  writePersistedCache(cacheKey(), next)
  return next
}

/** Warm the Collect list while the dashboard is idle (call from header). */
export function prefetchCollectJobs(): void {
  void globalMutate(COLLECT_JOBS_URL, fetchCollectJobs, { revalidate: true })
}

/** Shared Collect jobs feed — shows cached rows instantly, refreshes in background. */
export function useCollectJobsQuery(enabled: boolean) {
  const key = cacheKey()
  const fallbackData = useMemo(() => readPersistedCache<DispatchJob[]>(key), [key])

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    enabled ? COLLECT_JOBS_URL : null,
    () => fetchCollectJobs(),
    {
      ...defaultSwrConfig,
      fallbackData,
      revalidateOnFocus: true,
      keepPreviousData: true,
      // Prefer showing last session list over a spinner.
      revalidateIfStale: true,
    }
  )

  const hasCachedData = fallbackData !== undefined || data !== undefined
  const jobs = useMemo(() => {
    if (data !== undefined) return data
    return readPersistedCache<DispatchJob[]>(key) ?? fallbackData ?? EMPTY
  }, [data, key, fallbackData])

  return {
    jobs,
    error,
    /** True only when we have nothing to show yet. */
    isLoading: Boolean(enabled && isLoading && !hasCachedData),
    isValidating,
    mutate,
  }
}
