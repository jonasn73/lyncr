// Display helpers for hopper / pipeline job cards — defensive field resolution.

import { SERVICE_QUOTE_TYPES } from "@/lib/service-quote-calculator"
import type { UnassignedPoolJob } from "@/lib/types"

type PoolJobLike = UnassignedPoolJob & Record<string, unknown>

function readNumber(value: unknown): number | null {
  if (value == null || value === "") return null
  const n = typeof value === "number" ? value : Number.parseFloat(String(value))
  return Number.isFinite(n) ? n : null
}

function readString(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s || null
}

function firstNumber(job: PoolJobLike, keys: string[]): number | null {
  for (const key of keys) {
    const n = readNumber(job[key])
    if (n != null && n > 0) return n
  }
  return null
}

function firstString(job: PoolJobLike, keys: string[]): string | null {
  for (const key of keys) {
    const s = readString(job[key])
    if (s) return s
  }
  return null
}

/** Whole-dollar quote for card labels — prefers cents fields from ai_leads.collected. */
export function resolvePoolJobPriceDollars(job: UnassignedPoolJob): number {
  const row = job as PoolJobLike

  const cents = firstNumber(row, [
    "quoted_price_cents",
    "last_quoted_price_cents",
    "baseline_quoted_price_cents",
  ])
  if (cents != null) return Math.max(0, Math.round(cents / 100))

  const pricingMeta =
    row.pricing_metadata != null && typeof row.pricing_metadata === "object"
      ? (row.pricing_metadata as Record<string, unknown>)
      : null
  const metaCents = readNumber(pricingMeta?.quoted_price_cents)
  if (metaCents != null && metaCents > 0) return Math.max(0, Math.round(metaCents / 100))

  const dollars = firstNumber(row, [
    "custom_price",
    "customPrice",
    "price",
    "total_estimate",
    "totalEstimate",
  ])
  if (dollars != null) {
    return dollars >= 1000 ? Math.max(0, Math.round(dollars / 100)) : Math.max(0, Math.round(dollars))
  }

  return 0
}

export function formatPoolJobPriceLabel(job: UnassignedPoolJob): string {
  return `$${resolvePoolJobPriceDollars(job)}`
}

/** Human-readable service line for hopper cards. */
export function resolvePoolJobServiceLabel(job: UnassignedPoolJob): string {
  const row = job as PoolJobLike

  const pricingMeta =
    row.pricing_metadata != null && typeof row.pricing_metadata === "object"
      ? (row.pricing_metadata as Record<string, unknown>)
      : null
  const metaLabel = readString(pricingMeta?.dispatch_job_type_label)
  if (metaLabel) return metaLabel

  const direct = firstString(row, [
    "job_type",
    "service_type",
    "serviceType",
    "type",
    "service_package",
  ])
  if (direct) return direct

  const serviceId = firstString(row, ["service_quote_type_id", "serviceTypeId", "service_type_id"])
  if (serviceId) {
    const spec = SERVICE_QUOTE_TYPES.find((entry) => entry.id === serviceId)
    if (spec) return spec.label
    return serviceId
  }

  return "Service General"
}
