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

/** ZIP / postal code for hopper card location row. */
export function resolvePoolJobPostalCode(job: UnassignedPoolJob): string {
  const row = job as PoolJobLike
  return (
    firstString(row, [
      "postal_code",
      "postalCode",
      "zip_code",
      "zipCode",
      "job_address_postal_code",
    ]) ?? ""
  )
}

export type PoolJobBookingPriority = "CRITICAL" | "HIGH" | "LOW"

const POOL_JOB_PRIORITY_RANK: Record<PoolJobBookingPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  LOW: 2,
}

/** Time-based booking priority for unassigned hopper cards. */
export function resolvePoolJobBookingPriority(
  job: UnassignedPoolJob,
  now: Date = new Date()
): PoolJobBookingPriority {
  const row = job as PoolJobLike
  const scheduledRaw =
    readString(job.scheduled_at) ?? firstString(row, ["scheduledTime", "scheduled_time"])

  if (scheduledRaw) {
    const targetMs = new Date(scheduledRaw).getTime()
    if (!Number.isNaN(targetMs)) {
      const minutesUntil = (targetMs - now.getTime()) / 60_000
      if (minutesUntil <= 30) return "CRITICAL"
      if (minutesUntil <= 120) return "HIGH"
      return "LOW"
    }
  }

  const createdRaw = readString(job.created_at)
  if (createdRaw) {
    const createdMs = new Date(createdRaw).getTime()
    if (!Number.isNaN(createdMs)) {
      const ageMinutes = (now.getTime() - createdMs) / 60_000
      if (ageMinutes <= 30) return "CRITICAL"
      if (ageMinutes <= 120) return "HIGH"
    }
  }

  return "LOW"
}

export function comparePoolJobsByBookingPriority(
  a: UnassignedPoolJob,
  b: UnassignedPoolJob,
  now: Date = new Date()
): number {
  const rankA = POOL_JOB_PRIORITY_RANK[resolvePoolJobBookingPriority(a, now)]
  const rankB = POOL_JOB_PRIORITY_RANK[resolvePoolJobBookingPriority(b, now)]
  if (rankA !== rankB) return rankA - rankB

  const timeA = new Date(a.scheduled_at ?? a.created_at).getTime()
  const timeB = new Date(b.scheduled_at ?? b.created_at).getTime()
  if (!Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB) return timeA - timeB
  return a.id.localeCompare(b.id)
}

export const POOL_JOB_PRIORITY_CARD_CLASS: Record<PoolJobBookingPriority, string> = {
  CRITICAL: "border-l-4 border-rose-500 bg-rose-950/10",
  HIGH: "border-l-4 border-amber-500 bg-amber-950/5",
  LOW: "border-l-4 border-slate-700",
}

export const POOL_JOB_PRIORITY_BADGE_LABEL: Record<PoolJobBookingPriority, string> = {
  CRITICAL: "🚨 Urgent ASAP",
  HIGH: "⏳ Coming Up",
  LOW: "📅 Flexible Route",
}

export function sortPoolJobsByBookingPriority(
  jobs: UnassignedPoolJob[],
  now: Date = new Date()
): UnassignedPoolJob[] {
  return [...jobs].sort((a, b) => comparePoolJobsByBookingPriority(a, b, now))
}
