"use client"

import dynamic from "next/dynamic"
import { Suspense, memo, useLayoutEffect, useState, type ReactNode } from "react"
import type { PageId } from "@/components/app-shell"
import { DashboardPage } from "@/components/dashboard-page"
import { ActivityWorkspaceView } from "@/components/workspace-views/activity-workspace-view"
import { LeadsWorkspaceView } from "@/components/workspace-views/leads-workspace-view"
import { TeamWorkspaceView } from "@/components/workspace-views/team-workspace-view"
import { PayWorkspaceView } from "@/components/workspace-views/pay-workspace-view"
import { SettingsWorkspaceView } from "@/components/workspace-views/settings-workspace-view"

const SchedulerWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/scheduler-workspace-view").then((m) => ({
      default: m.SchedulerWorkspaceView,
    })),
  {
    ssr: false,
    loading: () => <div className="min-h-[40vh] w-full" aria-busy="true" aria-label="Loading scheduler" />,
  }
)

/** Primary command-dock segments kept mounted for instant tab swaps (no route branch flash). */
export const DASHBOARD_PRESENCE_PAGE_IDS = [
  "dashboard",
  "activity",
  "scheduler",
  "leads",
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
  return (
    <div className="w-full min-h-[calc(100dvh-4rem)]">
      <PresencePane active={activePage === "dashboard"} label="Routing">
        <RoutingPane />
      </PresencePane>
      <PresencePane active={activePage === "activity"} label="Activity" deferUntilVisit>
        <ActivityWorkspaceView />
      </PresencePane>
      <PresencePane active={activePage === "scheduler"} label="Scheduler" deferUntilVisit>
        <SchedulerWorkspaceView />
      </PresencePane>
      <PresencePane active={activePage === "leads"} label="Leads" deferUntilVisit>
        <LeadsWorkspaceView />
      </PresencePane>
      <PresencePane active={activePage === "contacts"} label="Team" deferUntilVisit>
        <TeamWorkspaceView />
      </PresencePane>
      <PresencePane active={activePage === "pay"} label="Pay" deferUntilVisit>
        <Suspense fallback={<div className="min-h-[40vh] w-full" aria-hidden />}>
          <PayWorkspaceView />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "settings"} label="Settings" deferUntilVisit>
        <SettingsWorkspaceView />
      </PresencePane>
    </div>
  )
})
