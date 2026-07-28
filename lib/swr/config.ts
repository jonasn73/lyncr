import type { SWRConfiguration } from "swr"

/** Shared SWR defaults — 10s dedupe window, keep prior page data during key changes. */
export const SWR_STALE_MS = 10_000

export const defaultSwrConfig: SWRConfiguration = {
  keepPreviousData: true,
  dedupingInterval: SWR_STALE_MS,
  // Off by default — tab focus was refetching every SWR feed and thrashing Neon.
  // Screens that need focus refresh (e.g. Collect jobs) opt in explicitly.
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  revalidateIfStale: true,
  errorRetryCount: 2,
}
