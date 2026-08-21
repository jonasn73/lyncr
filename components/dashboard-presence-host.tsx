"use client"

import dynamic from "next/dynamic"
import {
  Suspense,
  cloneElement,
  isValidElement,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react"
import { clearMainScrollLock } from "@/lib/mobile-scroll-lock"
import type { PageId } from "@/components/app-shell"
import { DashboardPage } from "@/components/dashboard-page"
import { prefetchOperationsData } from "@/lib/hooks/use-operations-data"
import {
  initialPresencePaneMounted,
  shouldMountPresencePane,
  shouldUseSsrActiveSlot,
} from "@/lib/dashboard-presence-ssr"
import { useFlickerDebugLifecycle } from "@/lib/debug/flicker-debug"
import { cn } from "@/lib/utils"

/**
 * Code-split inactive tabs — but NEVER show PaneFallback skeletons while the chunk loads.
 * Those shells were the multi-second flash on every tab except Lines (which is static).
 * Cache/session paint lives inside each view; a blank moment is better than fake tables.
 */
const ActivityWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/activity-workspace-view").then((m) => ({
      default: m.ActivityWorkspaceView,
    })),
  { ssr: false, loading: () => null }
)

const MessagesWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/messages-workspace-view").then((m) => ({
      default: m.MessagesWorkspaceView,
    })),
  { ssr: false, loading: () => null }
)

const SchedulerWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/scheduler-workspace-view").then((m) => ({
      default: m.SchedulerWorkspaceView,
    })),
  { ssr: false, loading: () => null }
)

const CrmWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/crm-workspace-view").then((m) => ({
      default: m.CrmWorkspaceView,
    })),
  { ssr: false, loading: () => null }
)

const MapWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/map-workspace-view").then((m) => ({
      default: m.MapWorkspaceView,
    })),
  { ssr: false, loading: () => null }
)

const PayWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/pay-workspace-view").then((m) => ({
      default: m.PayWorkspaceView,
    })),
  { ssr: false, loading: () => null }
)

const SettingsWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/settings-workspace-view").then((m) => ({
      default: m.SettingsWorkspaceView,
    })),
  { ssr: false, loading: () => null }
)

/** Primary command-dock segments kept mounted for instant tab swaps (no route branch flash). */
export const DASHBOARD_PRESENCE_PAGE_IDS = [
  "dashboard",
  "activity",
  "messages",
  "scheduler",
  "customers",
  "contacts",
  "pay",
  "settings",
] as const

export type DashboardPresencePageId = (typeof DASHBOARD_PRESENCE_PAGE_IDS)[number]

export function isDashboardPresencePage(page: PageId): page is DashboardPresencePageId {
  return (DASHBOARD_PRESENCE_PAGE_IDS as readonly string[]).includes(page)
}

const PresencePane = memo(function PresencePane({
  active,
  label,
  children,
  deferUntilVisit = false,
}: {
  active: boolean
  label: string
  children: ReactNode
  /** Skip mounting heavy panes until the user opens the tab once. */
  deferUntilVisit?: boolean
}) {
  // Active tab starts mounted so hard refresh SSR HTML is not `null` then a flash.
  const [visited, setVisited] = useState(() => initialPresencePaneMounted(deferUntilVisit, active))
  // Soft settle only on later tab returns — never on first show / hard refresh.
  const [settle, setSettle] = useState(false)
  const hasBeenActiveRef = useRef(false)
  // First click: `active` is true while `visited` is still false — mount this frame (no blank).
  const shouldMount = shouldMountPresencePane(deferUntilVisit, visited, active)
  if (shouldMount && !visited) {
    // Adjusting state during render from props (React-approved pattern).
    setVisited(true)
  }

  useFlickerDebugLifecycle(`PresencePane:${label}`, {
    active,
    visited,
    shouldMount,
    deferUntilVisit,
    settle,
    emptyUnmounted: !shouldMount,
  })

  useLayoutEffect(() => {
    if (!active) return
    setVisited(true)
    if (!hasBeenActiveRef.current) {
      hasBeenActiveRef.current = true
      return
    }
    setSettle(true)
    const timer = window.setTimeout(() => setSettle(false), 300)
    return () => window.clearTimeout(timer)
  }, [active])

  if (!shouldMount) return null

  return (
    <section
      role="tabpanel"
      aria-label={label}
      aria-hidden={!active}
      hidden={!active}
      className={cn("w-full", settle && "lyncr-pane-settle")}
    >
      {children}
    </section>
  )
})

function RoutingPane() {
  return <DashboardPage />
}

/** Pass live `isActive` into the statically imported page slot without remounting it. */
function renderSsrActivePane(slot: ReactNode, isActive: boolean): ReactNode {
  // page.tsx returns a single workspace view element — clone so polls pause off-tab.
  if (isValidElement(slot)) {
    return cloneElement(slot as ReactElement<{ isActive?: boolean }>, { isActive })
  }
  return slot
}

/** All primary dashboard views stay mounted; inactive panes use `hidden` so they never paint. */
export const DashboardPresenceHost = memo(function DashboardPresenceHost({
  activePage,
  ssrActiveSlot = null,
}: {
  activePage: DashboardPresencePageId
  /** Statically imported view from the matching dashboard route page (hard-refresh SSR). */
  ssrActiveSlot?: ReactNode
}) {
  // Freeze which URL was SSR’d — client tab clicks must not swap this slot into another pane.
  const [ssrPage] = useState(activePage)
  // Freeze the page element descriptor so navigation does not replace Activity with CRM children.
  const ssrSlotRef = useRef(ssrActiveSlot)

  useFlickerDebugLifecycle("DashboardPresenceHost", {
    activePage,
    ssrPage,
  })

  useEffect(() => {
    if (activePage === "scheduler") return
    clearMainScrollLock()
  }, [activePage])

  useEffect(() => {
    // Warm Activity call rows while the owner is still on Lines (or any tab).
    prefetchOperationsData()
    // Warm every deferred chunk ASAP so the first tab click is not a blank wait.
    void import("@/components/workspace-views/map-workspace-view")
    void import("@/components/workspace-views/activity-workspace-view")
    void import("@/components/workspace-views/crm-workspace-view")
    void import("@/components/workspace-views/scheduler-workspace-view")
    void import("@/components/workspace-views/messages-workspace-view")
    void import("@/components/workspace-views/pay-workspace-view")
    void import("@/components/workspace-views/settings-workspace-view")
    const warmChunks = () => {
      void import("@/components/workspace-views/crm-workspace-view")
      void import("@/components/workspace-views/messages-workspace-view")
      void import("@/components/workspace-views/map-workspace-view")
      void import("@/components/workspace-views/activity-workspace-view")
      void import("@/components/workspace-views/scheduler-workspace-view")
      void import("@/components/workspace-views/pay-workspace-view")
      void import("@/components/workspace-views/settings-workspace-view")
    }
    const idleId =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(warmChunks, { timeout: 1200 })
        : window.setTimeout(warmChunks, 400)
    return () => {
      if (typeof window.cancelIdleCallback === "function" && typeof idleId === "number") {
        window.cancelIdleCallback(idleId)
      } else {
        window.clearTimeout(idleId)
      }
    }
  }, [])

  return (
    <div className="w-full min-h-0">
      {/* Lines is statically imported here — intake lives in shell (LyncEngine), not this pane. */}
      <PresencePane active={activePage === "dashboard"} label="Routing">
        <RoutingPane />
      </PresencePane>
      <PresencePane active={activePage === "activity"} label="Activities" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "activity") ? (
          renderSsrActivePane(ssrSlotRef.current, activePage === "activity")
        ) : (
          <Suspense fallback={null}>
            <ActivityWorkspaceViewLazy isActive={activePage === "activity"} />
          </Suspense>
        )}
      </PresencePane>
      <PresencePane active={activePage === "messages"} label="Messages" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "messages") ? (
          renderSsrActivePane(ssrSlotRef.current, activePage === "messages")
        ) : (
          <Suspense fallback={null}>
            <MessagesWorkspaceViewLazy isActive={activePage === "messages"} />
          </Suspense>
        )}
      </PresencePane>
      <PresencePane active={activePage === "scheduler"} label="Scheduler" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "scheduler") ? (
          renderSsrActivePane(ssrSlotRef.current, activePage === "scheduler")
        ) : (
          <Suspense fallback={null}>
            <SchedulerWorkspaceViewLazy isActive={activePage === "scheduler"} />
          </Suspense>
        )}
      </PresencePane>
      <PresencePane active={activePage === "customers"} label="CRM" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "customers") ? (
          renderSsrActivePane(ssrSlotRef.current, activePage === "customers")
        ) : (
          <Suspense fallback={null}>
            <CrmWorkspaceViewLazy isActive={activePage === "customers"} />
          </Suspense>
        )}
      </PresencePane>
      <PresencePane active={activePage === "contacts"} label="Map" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "contacts") ? (
          renderSsrActivePane(ssrSlotRef.current, activePage === "contacts")
        ) : (
          <Suspense fallback={null}>
            <MapWorkspaceViewLazy isActive={activePage === "contacts"} />
          </Suspense>
        )}
      </PresencePane>
      <PresencePane active={activePage === "pay"} label="Pay" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "pay") ? (
          renderSsrActivePane(ssrSlotRef.current, activePage === "pay")
        ) : (
          <Suspense fallback={null}>
            <PayWorkspaceViewLazy isActive={activePage === "pay"} />
          </Suspense>
        )}
      </PresencePane>
      <PresencePane active={activePage === "settings"} label="Settings" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "settings") ? (
          renderSsrActivePane(ssrSlotRef.current, activePage === "settings")
        ) : (
          <Suspense fallback={null}>
            <SettingsWorkspaceViewLazy isActive={activePage === "settings"} />
          </Suspense>
        )}
      </PresencePane>
    </div>
  )
})
