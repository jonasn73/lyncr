/**
 * Hard-refresh paint helpers for the dashboard presence host.
 *
 * Tab click already keeps panes mounted. A full reload still has to SSR the
 * *active* URL’s view — `next/dynamic(..., { ssr: false })` always paints a
 * fallback/skeleton first. These helpers decide which pane uses the statically
 * imported route slot vs a deferred dynamic chunk.
 */

/** Primary tabs the presence host can keep mounted (matches PageId segments). */
const DASHBOARD_PRESENCE_SSR_PANE_IDS = [
  "dashboard",
  "activity",
  "messages",
  "scheduler",
  "customers",
  "contacts",
  "pay",
  "settings",
] as const

/**
 * Tabs whose route page.tsx statically imports the real view so a hard refresh
 * SSR's chrome immediately. Lines (dashboard) is already a static import
 * inside the presence host — it does not need a route slot.
 */
const DASHBOARD_ROUTE_SSR_PANE_IDS = [
  "activity",
  "messages",
  "scheduler",
  "customers",
  "contacts",
  "pay",
  "settings",
] as const

export type DashboardRouteSsrPaneId = (typeof DASHBOARD_ROUTE_SSR_PANE_IDS)[number]

/** True when this pane is one of the route-SSR tabs. */
export function isDashboardRouteSsrPane(page: string): page is DashboardRouteSsrPaneId {
  // Cast the tuple so `.includes` accepts a plain string from `activePage`.
  return (DASHBOARD_ROUTE_SSR_PANE_IDS as readonly string[]).includes(page)
}

/**
 * Use the statically imported page slot for this pane — only on the URL that
 * was hard-refreshed. Other tabs stay on `dynamic(ssr: false)` until visited.
 */
export function shouldUseSsrActiveSlot(ssrPage: string, paneId: string): boolean {
  // Same segment → this pane is the one Next.js already SSR’d via page.tsx.
  return ssrPage === paneId && isDashboardRouteSsrPane(paneId)
}

/**
 * Whether a pane should render the routed slot right now.
 *
 * Freezing the slot's element descriptor does not freeze what the App Router streams
 * through it — that outlet always renders the CURRENT route's page. So the slot only holds
 * the pane's own view while we are still on the URL that was SSR'd; after a client tab
 * click it holds the new page, which would then render inside the old page's pane.
 *
 * Scheduler → Map hit exactly that: the hidden Scheduler pane ended up holding a second
 * live Dispatch Map, so two Leaflet instances ran at once — double tiles, timers, markers,
 * and GPS polling, plus a visible flash as the second initialised.
 */
export function rendersSsrActiveSlot(
  ssrPage: string,
  activePage: string,
  paneId: string
): boolean {
  if (activePage !== ssrPage) return false
  return shouldUseSsrActiveSlot(ssrPage, paneId)
}

/**
 * First-paint mount flag for a presence pane.
 * Active tab always mounts (hard refresh must paint it). Deferred inactive
 * tabs stay unmounted until the owner opens them once.
 */
export function initialPresencePaneMounted(deferUntilVisit: boolean, active: boolean): boolean {
  // `deferUntilVisit` false → always mount (legacy / tests).
  if (!deferUntilVisit) return true
  // Active on first render → mount immediately (SSR + hydrate).
  return active
}

/**
 * Whether the pane should render on this pass.
 * When the owner first clicks a deferred tab, `active` flips true while
 * `visited` is still false — returning true here avoids a one-frame blank
 * (null) before useLayoutEffect can set visited.
 */
export function shouldMountPresencePane(
  deferUntilVisit: boolean,
  visited: boolean,
  active: boolean
): boolean {
  // Always-on panes (no defer) stay mounted.
  if (!deferUntilVisit) return true
  // Already opened once this session.
  if (visited) return true
  // First click / hard-refresh active URL — mount immediately (no null flash).
  return active
}

/**
 * True when this pane should load via `dynamic(ssr: false)` (inactive / not
 * the hard-refresh URL). The active SSR slot must never take this path.
 */
export function shouldUseDeferredDynamicPane(ssrPage: string, paneId: string): boolean {
  // Inverse of shouldUseSsrActiveSlot — keeps the rule in one place for tests.
  return !shouldUseSsrActiveSlot(ssrPage, paneId)
}
