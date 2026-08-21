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
import type { HoldQueueDayStats } from "@/lib/hold-queue-stats-cache"
import type { CrmListPaintSeed } from "@/lib/crm-list-paint-cache"
import type { MapPoolPaintSeed } from "@/lib/map-pool-paint-cache"
import type { SchedulerPaintSeed } from "@/lib/scheduler-paint-cache"
import type { MessagesPaintSeed } from "@/lib/messages-paint-cache"

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
  /** Lines “Today · Answer · Press 1 · Left” hold-queue rollup. */
  holdQueue: HoldQueueDayStats | null
  /** Compact CRM customer names for hard-refresh first paint. */
  crm: CrmListPaintSeed | null
  /** Compact Map job-pool rows for hard-refresh first paint. */
  mapPool: MapPoolPaintSeed | null
  /** Tiny Scheduler month flag — skip blank-board flash on hard refresh. */
  scheduler: SchedulerPaintSeed | null
  /** Compact Messages thread previews for hard-refresh first paint. */
  messages: MessagesPaintSeed | null
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
  holdQueue: null,
  crm: null,
  mapPool: null,
  scheduler: null,
  messages: null,
}
