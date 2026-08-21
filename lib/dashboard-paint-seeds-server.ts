/**
 * Server-only: build dashboard paint seeds from the request cookie jar.
 * Kept separate from the client Provider so layout.tsx can import cleanly.
 */

import {
  EMPTY_DASHBOARD_PAINT_SEEDS,
  type DashboardPaintSeeds,
} from "@/lib/dashboard-paint-seeds-types"
import {
  HEADER_MONEY_COOKIE,
  type HeaderMoneyCache,
} from "@/lib/header-money-cache"
import {
  ROUTING_TELEMETRY_COOKIE,
  readRoutingTelemetryCache,
  type RoutingTelemetrySnapshot,
} from "@/lib/routing-telemetry-cache"
import { BILLING_SUMMARY_COOKIE, type BillingSummaryCache } from "@/lib/billing-summary-cache"
import {
  OWNER_LATEST_COOKIE,
  sanitizeLatestPaintCookieItems,
} from "@/lib/owner-latest-cache"
import { LATEST_SEEN_COOKIE } from "@/lib/latest-seen-paint"
import {
  PRESENCE_COOKIE,
  readPresencePaintFromCookieRaw,
} from "@/lib/account-presence-cache"
import {
  WORKSPACE_LABEL_COOKIE,
  readWorkspaceLabelFromCookieRaw,
} from "@/lib/workspace-label-cache"
import {
  LINES_CHROME_COOKIE,
  readLinesChromeFromCookieRaw,
} from "@/lib/lines-chrome-cache"
import {
  MISSED_LEADS_COOKIE,
  readMissedLeadsFromCookieRaw,
} from "@/lib/missed-lead-insights-cache"
import {
  OPERATIONS_PAINT_COOKIE,
  operationsPaintMatchesOrg,
  readOperationsPaintFromCookieRaw,
} from "@/lib/operations-paint-cache"
import {
  HOLD_QUEUE_STATS_COOKIE,
  readHoldQueueStatsFromCookieRaw,
} from "@/lib/hold-queue-stats-cache"
import {
  CRM_LIST_PAINT_COOKIE,
  readCrmListPaintFromCookieRaw,
} from "@/lib/crm-list-paint-cache"
import {
  MAP_POOL_PAINT_COOKIE,
  readMapPoolPaintFromCookieRaw,
} from "@/lib/map-pool-paint-cache"
import {
  SCHEDULER_PAINT_COOKIE,
  readSchedulerPaintFromCookieRaw,
} from "@/lib/scheduler-paint-cache"
import { readPaintSeedCookieValue } from "@/lib/paint-seed-cookie"
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/workspace-organizations"
import type { LatestCustomerAction } from "@/lib/latest-customer-actions"

type TelemetryPaintCookie = {
  organizationId: string | null
  snapshot: RoutingTelemetrySnapshot
}

type LatestPaintCookie = {
  organizationId: string | null
  items: LatestCustomerAction[]
}

/** Cookie getter shape — matches Next.js `cookies().get(name)?.value`. */
export type PaintCookieGetter = (name: string) => string | undefined

/**
 * Parse paint cookies into a DashboardPaintSeeds object for SSR first paint.
 * Returns the shared empty sentinel when nothing usable is present.
 */
export function readDashboardPaintSeedsFromCookies(
  getCookie: PaintCookieGetter
): DashboardPaintSeeds {
  const moneyRaw = getCookie(HEADER_MONEY_COOKIE)
  const money = readPaintSeedCookieValue<HeaderMoneyCache>(moneyRaw)
  const moneyOk = money && typeof money.availableCents === "number" ? money : null

  const telemetryRaw = getCookie(ROUTING_TELEMETRY_COOKIE)
  const telemetryCookie = readPaintSeedCookieValue<TelemetryPaintCookie>(telemetryRaw)
  const telemetryOrg = telemetryCookie?.organizationId ?? null
  const telemetry =
    readRoutingTelemetryCache(telemetryOrg, telemetryRaw, {
      snapshot: telemetryCookie?.snapshot ?? null,
      organizationId: telemetryOrg,
    }) ?? null

  const latestRaw = getCookie(OWNER_LATEST_COOKIE)
  const latestCookie = readPaintSeedCookieValue<LatestPaintCookie>(latestRaw)
  const seenRaw = getCookie(LATEST_SEEN_COOKIE)
  // Keep empty arrays — they mean “confirmed nothing hot”, not “unknown / still loading”.
  // Age + Clear/open stamps applied here so SSR matches the hydrated list (no flash).
  const latest =
    latestCookie?.items && Array.isArray(latestCookie.items)
      ? sanitizeLatestPaintCookieItems(latestCookie.items, seenRaw)
      : null

  const billingRaw = getCookie(BILLING_SUMMARY_COOKIE)
  const billing = readPaintSeedCookieValue<BillingSummaryCache>(billingRaw)
  const billingOk =
    billing && typeof billing.credit_balance_cents === "number" ? billing : null

  const presenceRaw = getCookie(PRESENCE_COOKIE)
  const presence = readPresencePaintFromCookieRaw(presenceRaw)

  const workspaceRaw = getCookie(WORKSPACE_LABEL_COOKIE)
  const workspaceParsed = readWorkspaceLabelFromCookieRaw(workspaceRaw)

  const linesRaw = getCookie(LINES_CHROME_COOKIE)
  const linesParsed = readLinesChromeFromCookieRaw(linesRaw)

  const missedLeadsRaw = getCookie(MISSED_LEADS_COOKIE)
  const missedLeads = readMissedLeadsFromCookieRaw(missedLeadsRaw)

  const operationsRaw = getCookie(OPERATIONS_PAINT_COOKIE)
  const operationsParsed = readOperationsPaintFromCookieRaw(operationsRaw)
  const holdQueueRaw = getCookie(HOLD_QUEUE_STATS_COOKIE)
  const holdQueue = readHoldQueueStatsFromCookieRaw(holdQueueRaw)
  // Prefer active-shop cookie, then Lines / workspace paint labels.
  const activeOrgId =
    getCookie(ACTIVE_ORGANIZATION_COOKIE)?.trim() ||
    linesParsed?.organizationId ||
    workspaceParsed?.organizationId ||
    null
  const paintOrgOk = (organizationId: string | null | undefined) =>
    operationsPaintMatchesOrg(
      { organizationId: organizationId ?? null, calls: [], fetchedAt: 0 },
      activeOrgId
    )
  const workspace = workspaceParsed && paintOrgOk(workspaceParsed.organizationId) ? workspaceParsed : null
  const lines = linesParsed && paintOrgOk(linesParsed.organizationId) ? linesParsed : null
  const telemetryForShop = paintOrgOk(telemetryOrg) ? telemetry : null
  const latestForShop =
    latest && paintOrgOk(latestCookie?.organizationId ?? null) ? latest : null
  // Never SSR another shop’s callers into the Activity seed payload.
  const operations =
    operationsParsed && operationsPaintMatchesOrg(operationsParsed, activeOrgId)
      ? operationsParsed
      : null

  const crmRaw = getCookie(CRM_LIST_PAINT_COOKIE)
  const crmParsed = readCrmListPaintFromCookieRaw(crmRaw)
  const crm =
    crmParsed &&
    operationsPaintMatchesOrg(
      { organizationId: crmParsed.organizationId, calls: [], fetchedAt: 0 },
      activeOrgId
    )
      ? crmParsed
      : null

  const mapPoolRaw = getCookie(MAP_POOL_PAINT_COOKIE)
  const mapPoolParsed = readMapPoolPaintFromCookieRaw(mapPoolRaw)
  const mapPool =
    mapPoolParsed &&
    operationsPaintMatchesOrg(
      { organizationId: mapPoolParsed.organizationId, calls: [], fetchedAt: 0 },
      activeOrgId
    )
      ? mapPoolParsed
      : null

  const schedulerRaw = getCookie(SCHEDULER_PAINT_COOKIE)
  const schedulerParsed = readSchedulerPaintFromCookieRaw(schedulerRaw)
  const scheduler =
    schedulerParsed &&
    operationsPaintMatchesOrg(
      { organizationId: schedulerParsed.organizationId, calls: [], fetchedAt: 0 },
      activeOrgId
    )
      ? schedulerParsed
      : null

  if (
    !moneyOk &&
    !telemetryForShop &&
    !latestForShop &&
    !billingOk &&
    !presence &&
    !workspace &&
    !lines &&
    !missedLeads &&
    !operations &&
    !holdQueue &&
    !crm &&
    !mapPool &&
    !scheduler
  ) {
    return EMPTY_DASHBOARD_PAINT_SEEDS
  }

  return {
    money: moneyOk,
    telemetry: telemetryForShop,
    telemetryOrganizationId: telemetryForShop ? telemetryCookie?.organizationId ?? null : null,
    latest: latestForShop,
    latestOrganizationId: latestForShop ? latestCookie?.organizationId ?? null : null,
    billing: billingOk,
    presence,
    workspace,
    lines,
    missedLeads,
    operations,
    holdQueue,
    crm,
    mapPool,
    scheduler,
  }
}
