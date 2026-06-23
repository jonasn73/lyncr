import type { SWRConfiguration } from "swr"

/** Shared SWR defaults — 10s dedupe window, keep prior page data during key changes. */
export const SWR_STALE_MS = 10_000

export const defaultSwrConfig: SWRConfiguration = {
  keepPreviousData: true,
  dedupingInterval: SWR_STALE_MS,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  revalidateIfStale: true,
  errorRetryCount: 2,
}
