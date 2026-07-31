/**
 * Shared paint-seed types (no "use client") — safe for layout + client Provider.
 */

import type { HeaderMoneyCache } from "@/lib/header-money-cache"
import type { RoutingTelemetrySnapshot } from "@/lib/routing-telemetry-cache"
import type { LatestCustomerAction } from "@/lib/latest-customer-actions"
import type { BillingSummaryCache } from "@/lib/billing-summary-cache"

/** Last-known dashboard values from paint cookies (SSR) or empty. */
export type DashboardPaintSeeds = {
  money: HeaderMoneyCache | null
  telemetry: RoutingTelemetrySnapshot | null
  /** Org id the telemetry seed was stored under (must match cache keys). */
  telemetryOrganizationId: string | null
  latest: LatestCustomerAction[] | null
  latestOrganizationId: string | null
  /** Carrier credit / Pay tab. */
  billing: BillingSummaryCache | null
}

/** Stable empty sentinel — same reference on every miss. */
export const EMPTY_DASHBOARD_PAINT_SEEDS: DashboardPaintSeeds = {
  money: null,
  telemetry: null,
  telemetryOrganizationId: null,
  latest: null,
  latestOrganizationId: null,
  billing: null,
}
