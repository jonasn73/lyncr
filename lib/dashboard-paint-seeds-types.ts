/**
 * Shared paint-seed types (no "use client") — safe for layout + client Provider.
 */

import type { PresenceStatus } from "@/lib/account-presence"
import type { HeaderMoneyCache } from "@/lib/header-money-cache"
import type { RoutingTelemetrySnapshot } from "@/lib/routing-telemetry-cache"
import type { LatestCustomerAction } from "@/lib/latest-customer-actions"
import type { BillingSummaryCache } from "@/lib/billing-summary-cache"
import type { WorkspaceLabelCache } from "@/lib/workspace-label-cache"
import type { LinesChromeCache } from "@/lib/lines-chrome-cache"
import type { MissedLeadsPaintSeed } from "@/lib/missed-lead-insights-cache"
import type { OperationsPaintSeed } from "@/lib/operations-paint-cache"

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
  /** Presence Busy / Available / On-job / Closed. */
  presence: PresenceStatus | null
  /** Active workspace name for the header org switcher. */
  workspace: WorkspaceLabelCache | null
  /** Main Line / Live & Connected chrome under the header. */
  lines: LinesChromeCache | null
  /** MISSED ticker “N leads” sublabel — counts only. */
  missedLeads: MissedLeadsPaintSeed | null
  /** Compact Activity call rows for hard-refresh first paint. */
  operations: OperationsPaintSeed | null
}

/** Stable empty sentinel — same reference on every miss. */
export const EMPTY_DASHBOARD_PAINT_SEEDS: DashboardPaintSeeds = {
  money: null,
  telemetry: null,
  telemetryOrganizationId: null,
  latest: null,
  latestOrganizationId: null,
  billing: null,
  presence: null,
  workspace: null,
  lines: null,
  missedLeads: null,
  operations: null,
}
