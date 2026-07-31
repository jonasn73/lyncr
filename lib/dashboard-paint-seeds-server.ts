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
import { OWNER_LATEST_COOKIE } from "@/lib/owner-latest-cache"
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
import { readPaintSeedCookieValue } from "@/lib/paint-seed-cookie"
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
  const latest =
    latestCookie?.items && Array.isArray(latestCookie.items) && latestCookie.items.length > 0
      ? latestCookie.items
      : null

  const billingRaw = getCookie(BILLING_SUMMARY_COOKIE)
  const billing = readPaintSeedCookieValue<BillingSummaryCache>(billingRaw)
  const billingOk =
    billing && typeof billing.credit_balance_cents === "number" ? billing : null

  const presenceRaw = getCookie(PRESENCE_COOKIE)
  const presence = readPresencePaintFromCookieRaw(presenceRaw)

  const workspaceRaw = getCookie(WORKSPACE_LABEL_COOKIE)
  const workspace = readWorkspaceLabelFromCookieRaw(workspaceRaw)

  const linesRaw = getCookie(LINES_CHROME_COOKIE)
  const lines = readLinesChromeFromCookieRaw(linesRaw)

  if (!moneyOk && !telemetry && !latest && !billingOk && !presence && !workspace && !lines) {
    return EMPTY_DASHBOARD_PAINT_SEEDS
  }

  return {
    money: moneyOk,
    telemetry,
    telemetryOrganizationId: telemetryCookie?.organizationId ?? null,
    latest,
    latestOrganizationId: latestCookie?.organizationId ?? null,
    billing: billingOk,
    presence,
    workspace,
    lines,
  }
}
