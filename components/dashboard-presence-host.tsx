"use client"

import dynamic from "next/dynamic"
import { Suspense, memo, useEffect, useLayoutEffect, useState, type ReactNode } from "react"
import { clearMainScrollLock } from "@/lib/mobile-scroll-lock"
import type { PageId } from "@/components/app-shell"
import { DashboardPage } from "@/components/dashboard-page"
import { readBillingSummaryCache } from "@/lib/billing-summary-cache"
import {
  ActivityTableSkeleton,
  CallFlowStepsSkeleton,
} from "@/components/workspace-content-skeletons"
import { SchedulerCalendarStatsSkeleton } from "@/components/scheduler/scheduler-panel-skeletons"

/** Layout-matched placeholder while a deferred tab chunk loads (not an empty black flash). */
function PaneLoadingFallback({ label }: { label: string }) {
  if (label === "Activity") {
    return (
      <div className="w-full px-3 pt-4 sm:px-4" aria-busy="true" aria-label="Loading Activity">
        <p className="mb-3 text-lg font-semibold text-foreground">Activity</p>
        <ActivityTableSkeleton />
      </div>
    )
  }
  if (label === "CRM") {
    return (
      <div className="w-full px-3 pt-4 sm:px-4" aria-busy="true" aria-label="Loading CRM">
        <p className="mb-3 text-lg font-semibold text-foreground">Customers</p>
        <ActivityTableSkeleton />
      </div>
    )
  }
  if (label === "scheduler") {
    return (
      <div className="w-full px-3 pt-4 sm:px-4" aria-busy="true" aria-label="Loading Scheduler">
        <p className="mb-3 text-lg font-semibold text-foreground">Scheduler</p>
        <SchedulerCalendarStatsSkeleton />
        <div className="mt-4">
          <CallFlowStepsSkeleton />
        </div>
      </div>
    )
  }
  if (label === "Map") {
    return (
      <div
        className="relative min-h-[70vh] w-full overflow-hidden bg-zinc-950"
        aria-busy="true"
        aria-label="Loading Map"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(39,39,42,0.9),transparent_55%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 border-t border-zinc-800/80 bg-zinc-950/90" />
      </div>
    )
  }
  if (label === "Messages") {
    return (
      <div className="w-full px-3 pt-4 sm:px-4" aria-busy="true" aria-label="Loading Messages">
        <p className="mb-3 text-lg font-semibold text-foreground">Messages</p>
        <div className="min-h-[20rem] rounded-2xl border border-border/60 bg-card/40" />
      </div>
    )
  }
  return (
    <div className="min-h-[40vh] w-full px-3 pt-4 sm:px-4" aria-busy="true" aria-label={`Loading ${label}`}>
      <p className="text-lg font-semibold text-foreground capitalize">{label}</p>
      <div className="mt-4 min-h-[12rem] rounded-2xl border border-border/60 bg-card/40" />
    </div>
  )
}

/** Pay chunk loading — paint last-known carrier credit so the tab doesn’t flash blank→$0→real. */
function PayLoadingFallback() {
  const cached = typeof window !== "undefined" ? readBillingSummaryCache() : null
  const label = cached?.credit_balance_label
  return (
    <div className="min-h-[40vh] w-full px-4 pt-6" aria-busy="true" aria-label="Loading Pay">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Billing</p>
      <p className="mt-1 text-lg font-semibold text-foreground">Pay</p>
      <div className="mt-6 grid min-h-[5.75rem] gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card/80 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Lyncr Talk-Time Balance
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{label ?? "—"}</p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card/80 px-4 py-3 opacity-60">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Talk-time used (recent)
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">—</p>
        </div>
      </div>
    </div>
  )
}

// Heavy workspace panes — code-split so Lines first paint does not parse CRM/Activity/etc.
const ActivityWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/activity-workspace-view").then((m) => ({
      default: m.ActivityWorkspaceView,
    })),
  { ssr: false, loading: () => <PaneLoadingFallback label="Activity" /> }
)

const MessagesWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/messages-workspace-view").then((m) => ({
      default: m.MessagesWorkspaceView,
    })),
  { ssr: false, loading: () => <PaneLoadingFallback label="Messages" /> }
)

const SchedulerWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/scheduler-workspace-view").then((m) => ({
      default: m.SchedulerWorkspaceView,
    })),
  { ssr: false, loading: () => <PaneLoadingFallback label="scheduler" /> }
)

const CrmWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/crm-workspace-view").then((m) => ({
      default: m.CrmWorkspaceView,
    })),
  { ssr: false, loading: () => <PaneLoadingFallback label="CRM" /> }
)

const MapWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/map-workspace-view").then((m) => ({
      default: m.MapWorkspaceView,
    })),
  { ssr: false, loading: () => <PaneLoadingFallback label="Map" /> }
)

const PayWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/pay-workspace-view").then((m) => ({
      default: m.PayWorkspaceView,
    })),
  { ssr: false, loading: () => <PayLoadingFallback /> }
)

const SettingsWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/settings-workspace-view").then((m) => ({
      default: m.SettingsWorkspaceView,
    })),
  { ssr: false, loading: () => <PaneLoadingFallback label="Settings" /> }
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

  return (
    <div className="w-full min-h-0 md:min-h-[calc(100dvh-4rem)]">
      {/* Lines defer when refreshing on another tab — intake lives in shell (LyncEngine), not here. */}
      <PresencePane active={activePage === "dashboard"} label="Routing" deferUntilVisit>
        <RoutingPane />
      </PresencePane>
      <PresencePane active={activePage === "activity"} label="Activities" deferUntilVisit>
        <Suspense fallback={<PaneLoadingFallback label="Activity" />}>
          <ActivityWorkspaceView isActive={activePage === "activity"} />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "messages"} label="Messages" deferUntilVisit>
        <Suspense fallback={<PaneLoadingFallback label="Messages" />}>
          <MessagesWorkspaceView isActive={activePage === "messages"} />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "scheduler"} label="Scheduler" deferUntilVisit>
        <Suspense fallback={<PaneLoadingFallback label="scheduler" />}>
          <SchedulerWorkspaceView isActive={activePage === "scheduler"} />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "customers"} label="CRM" deferUntilVisit>
        <Suspense fallback={<PaneLoadingFallback label="CRM" />}>
          <CrmWorkspaceView isActive={activePage === "customers"} />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "contacts"} label="Map" deferUntilVisit>
        <Suspense fallback={<PaneLoadingFallback label="Map" />}>
          <MapWorkspaceView isActive={activePage === "contacts"} />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "pay"} label="Pay" deferUntilVisit>
        <Suspense fallback={<PayLoadingFallback />}>
          <PayWorkspaceView isActive={activePage === "pay"} />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "settings"} label="Settings" deferUntilVisit>
        <Suspense fallback={<PaneLoadingFallback label="Settings" />}>
          <SettingsWorkspaceView isActive={activePage === "settings"} />
        </Suspense>
      </PresencePane>
    </div>
  )
})
