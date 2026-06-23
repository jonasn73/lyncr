"use client"

import { useMemo } from "react"
import useSWR from "swr"
import {
  businessNumbersMatch,
  isDashboardVisibleLineStatus,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import type { PhoneNumberRoutingSummary } from "@/lib/types"
import { organizationQueryString } from "@/lib/workspace-organizations"
import { defaultSwrConfig } from "@/lib/swr/config"
import { swrJsonFetcher } from "@/lib/swr/fetcher"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

type NumbersMineResponse = {
  numbers?: unknown[]
  reserved_number?: string | null
}

export type BusinessNumbersQueryResult = {
  numbers: DashboardBusinessNumber[]
  reservedNumber: string | null
}

const EMPTY_BUSINESS_NUMBERS: DashboardBusinessNumber[] = []

function mapNumbersResponse(data: NumbersMineResponse): BusinessNumbersQueryResult {
  if (!Array.isArray(data.numbers)) {
    return { numbers: [], reservedNumber: null }
  }
  const numbers = data.numbers
    .filter((n) => isDashboardVisibleLineStatus(String((n as { status: string }).status)))
    .map((n) => {
      const row = n as Record<string, unknown>
      return {
        number: String(row.number),
        status: String(row.status),
        label: row.label != null ? String(row.label) : undefined,
        organization_id: row.organization_id != null ? String(row.organization_id) : null,
        industry_tag: row.industry_tag != null ? String(row.industry_tag) : null,
        source_provider: row.source_provider === "external" ? ("external" as const) : ("telnyx" as const),
        routing_summary: row.routing_summary as PhoneNumberRoutingSummary | undefined,
        admin_routing_override_phone:
          row.admin_routing_override_phone != null ? String(row.admin_routing_override_phone) : null,
      }
    })
  return {
    numbers,
    reservedNumber: data.reserved_number?.trim() || null,
  }
}

export function businessNumbersMineUrl(activeOrganizationId: string | null): string {
  const orgQs = organizationQueryString(activeOrganizationId)
  return `/api/numbers/mine${orgQs}`
}

export function useBusinessNumbersQuery(activeOrganizationId: string | null) {
  const url = businessNumbersMineUrl(activeOrganizationId)
  const cacheKey = persistedCacheKey("business-numbers", activeOrganizationId ?? "default")

  const fallbackData = useMemo(
    () => readPersistedCache<BusinessNumbersQueryResult>(cacheKey),
    [cacheKey]
  )

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    url,
    (key: string) =>
      swrJsonFetcher<NumbersMineResponse>(key).then((json) => {
        const mapped = mapNumbersResponse(json)
        writePersistedCache(cacheKey, mapped)
        return mapped
      }),
    {
      ...defaultSwrConfig,
      keepPreviousData: false,
      fallbackData,
    }
  )

  const hasCachedData = fallbackData !== undefined || data !== undefined
  const numbers = useMemo(
    () => data?.numbers ?? fallbackData?.numbers ?? EMPTY_BUSINESS_NUMBERS,
    [data, fallbackData]
  )
  const reservedNumber = data?.reservedNumber ?? fallbackData?.reservedNumber ?? null

  return {
    numbers,
    reservedNumber,
    error,
    /** True only when there is no cached or fetched data yet. */
    isLoading: isLoading && !hasCachedData,
    isValidating,
    mutate,
  }
}

/** Suspense-friendly variant — throws the SWR promise until phone lines resolve. */
export function useBusinessNumbersSuspenseQuery(activeOrganizationId: string | null) {
  const url = businessNumbersMineUrl(activeOrganizationId)
  const cacheKey = persistedCacheKey("business-numbers", activeOrganizationId ?? "default")

  const fallbackData = useMemo(
    () => readPersistedCache<BusinessNumbersQueryResult>(cacheKey),
    [cacheKey]
  )

  const { data } = useSWR(
    url,
    (key: string) =>
      swrJsonFetcher<NumbersMineResponse>(key).then((json) => {
        const mapped = mapNumbersResponse(json)
        writePersistedCache(cacheKey, mapped)
        return mapped
      }),
    {
      ...defaultSwrConfig,
      keepPreviousData: false,
      fallbackData,
      suspense: true,
    }
  )

  const numbers = useMemo(
    () => data?.numbers ?? fallbackData?.numbers ?? EMPTY_BUSINESS_NUMBERS,
    [data, fallbackData]
  )
  const reservedNumber = data?.reservedNumber ?? fallbackData?.reservedNumber ?? null

  return { numbers, reservedNumber }
}

/** Pick active line from reserved hint + current selection. */
export function resolveActiveLineAfterNumbers(
  numbers: DashboardBusinessNumber[],
  reservedNumber: string | null,
  previous: string | null
): string | null {
  if (previous && numbers.some((x) => businessNumbersMatch(x.number, previous))) {
    return previous
  }
  if (reservedNumber && numbers.some((x) => businessNumbersMatch(x.number, reservedNumber))) {
    return reservedNumber
  }
  return numbers[0]?.number ?? null
}
