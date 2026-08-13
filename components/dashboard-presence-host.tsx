"use client"

import dynamic from "next/dynamic"
import { Suspense, memo, useEffect, useLayoutEffect, useState, type ReactNode } from "react"
import { clearMainScrollLock } from "@/lib/mobile-scroll-lock"
import type { PageId } from "@/components/app-shell"
import { DashboardPage } from "@/components/dashboard-page"
import {
  ActivityPaneFallback,
  CrmPaneFallback,
  MapPaneFallback,
  MessagesPaneFallback,
  PayPaneFallback,
  SchedulerPaneFallback,
  SettingsPaneFallback,
} from "@/components/workspace-pane-fallbacks"
import { prefetchOperationsData } from "@/lib/hooks/use-operations-data"

// Heavy workspace panes — code-split so Lines first paint does not parse CRM/Activity/etc.
const ActivityWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/activity-workspace-view").then((m) => ({
      default: m.ActivityWorkspaceView,
    })),
  { ssr: false, loading: () => <ActivityPaneFallback /> }
)

const MessagesWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/messages-workspace-view").then((m) => ({
      default: m.MessagesWorkspaceView,
    })),
  { ssr: false, loading: () => <MessagesPaneFallback /> }
)

const SchedulerWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/scheduler-workspace-view").then((m) => ({
      default: m.SchedulerWorkspaceView,
    })),
  { ssr: false, loading: () => <SchedulerPaneFallback /> }
)

const CrmWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/crm-workspace-view").then((m) => ({
      default: m.CrmWorkspaceView,
    })),
  { ssr: false, loading: () => <CrmPaneFallback /> }
)

const MapWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/map-workspace-view").then((m) => ({
      default: m.MapWorkspaceView,
    })),
  { ssr: false, loading: () => <MapPaneFallback /> }
)

const PayWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/pay-workspace-view").then((m) => ({
      default: m.PayWorkspaceView,
    })),
  { ssr: false, loading: () => <PayPaneFallback /> }
)

const SettingsWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/settings-workspace-view").then((m) => ({
      default: m.SettingsWorkspaceView,
    })),
  { ssr: false, loading: () => <SettingsPaneFallback /> }
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
  const [mounted, setMounted] = useState(!deferUntilVisit || active)

  useLayoutEffect(() => {
    if (active) setMounted(true)
  }, [active])

  if (!mounted) return null

  return (
    <section role="tabpanel" aria-label={label} aria-hidden={!active} hidden={!active} className="w-full">
      {children}
    </section>
  )
})

function RoutingPane() {
  return <DashboardPage />
}

/** All primary dashboard views stay mounted; inactive panes use `hidden` so they never paint. */
export const DashboardPresenceHost = memo(function DashboardPresenceHost({
  activePage,
}: {
  activePage: DashboardPresencePageId
}) {
  useEffect(() => {
    if (activePage === "scheduler") return
    clearMainScrollLock()
  }, [activePage])

  useEffect(() => {
    // Warm Activity call rows while the owner is still on Lines (or any tab).
    prefetchOperationsData()
    // Preload heavy pane chunks on idle so the first tab click is not a dynamic() fallback flash.
    const warmChunks = () => {
      void import("@/components/workspace-views/activity-workspace-view")
      void import("@/components/workspace-views/crm-workspace-view")
      void import("@/components/workspace-views/messages-workspace-view")
      void import("@/components/workspace-views/map-workspace-view")
    }
    const idleId =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(warmChunks, { timeout: 1800 })
        : window.setTimeout(warmChunks, 1200)
    return () => {
      if (typeof window.cancelIdleCallback === "function" && typeof idleId === "number") {
        window.cancelIdleCallback(idleId)
      } else {
        window.clearTimeout(idleId)
      }
    }
  }, [])

  return (
    <div className="w-full min-h-0 md:min-h-[calc(100dvh-4rem)]">
      {/* Lines defer when refreshing on another tab — intake lives in shell (LyncEngine), not here. */}
      <PresencePane active={activePage === "dashboard"} label="Routing" deferUntilVisit>
        <RoutingPane />
      </PresencePane>
      <PresencePane active={activePage === "activity"} label="Activities" deferUntilVisit>
        {/* null fallback: useSearchParams must not replace a painted Activity pane with skeleton chrome. */}
        <Suspense fallback={null}>
          <ActivityWorkspaceView isActive={activePage === "activity"} />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "messages"} label="Messages" deferUntilVisit>
        <Suspense fallback={null}>
          <MessagesWorkspaceView isActive={activePage === "messages"} />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "scheduler"} label="Scheduler" deferUntilVisit>
        <Suspense fallback={null}>
          <SchedulerWorkspaceView isActive={activePage === "scheduler"} />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "customers"} label="CRM" deferUntilVisit>
        <Suspense fallback={null}>
          <CrmWorkspaceView isActive={activePage === "customers"} />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "contacts"} label="Map" deferUntilVisit>
        <Suspense fallback={null}>
          <MapWorkspaceView isActive={activePage === "contacts"} />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "pay"} label="Pay" deferUntilVisit>
        <Suspense fallback={null}>
          <PayWorkspaceView isActive={activePage === "pay"} />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "settings"} label="Settings" deferUntilVisit>
        <Suspense fallback={null}>
          <SettingsWorkspaceView isActive={activePage === "settings"} />
        </Suspense>
      </PresencePane>
    </div>
  )
})
