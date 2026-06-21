"use client"

import { Suspense, memo, type ReactNode } from "react"
import type { PageId } from "@/components/app-shell"
import { cn } from "@/lib/utils"
import { DashboardPage } from "@/components/dashboard-page"
import { DashboardSettingsModalsHost } from "@/components/dashboard/settings-modals-host"
import { ActivityWorkspaceView } from "@/components/workspace-views/activity-workspace-view"
import { LeadsWorkspaceView } from "@/components/workspace-views/leads-workspace-view"
import { TeamWorkspaceView } from "@/components/workspace-views/team-workspace-view"
import { PayWorkspaceView } from "@/components/workspace-views/pay-workspace-view"
import { SettingsWorkspaceView } from "@/components/workspace-views/settings-workspace-view"

/** Primary dashboard segments kept mounted in the DOM for instant tab swaps. */
export const DASHBOARD_PRESENCE_PAGE_IDS = [
  "dashboard",
  "activity",
  "leads",
  "contacts",
  "pay",
  "settings",
] as const

export type DashboardPresencePageId = (typeof DASHBOARD_PRESENCE_PAGE_IDS)[number]

export function isDashboardPresencePage(page: PageId): page is DashboardPresencePageId {
  return (DASHBOARD_PRESENCE_PAGE_IDS as readonly string[]).includes(page)
}

const PRESENCE_ACTIVE =
  "relative z-10 w-full opacity-100 pointer-events-auto visible select-auto"

const PRESENCE_INACTIVE =
  "absolute inset-x-0 top-0 z-0 w-full opacity-0 pointer-events-none invisible select-none [content-visibility:hidden]"

const PresencePane = memo(function PresencePane({
  active,
  label,
  children,
}: {
  active: boolean
  label: string
  children: ReactNode
}) {
  return (
    <section
      role="tabpanel"
      aria-label={label}
      aria-hidden={!active}
      className={cn(active ? PRESENCE_ACTIVE : PRESENCE_INACTIVE)}
    >
      {children}
    </section>
  )
})

function RoutingPaneFallback() {
  return <div className="min-h-[40vh] w-full" aria-hidden />
}


function RoutingPane() {
  return (
    <Suspense fallback={<RoutingPaneFallback />}>
      <DashboardPage />
    </Suspense>
  )
}

/**
 * All primary dashboard views stay mounted; visibility toggles via CSS only (no mount/unmount).
 */
export const DashboardPresenceHost = memo(function DashboardPresenceHost({
  activePage,
}: {
  activePage: DashboardPresencePageId
}) {
  return (
    <div className="relative w-full min-h-[calc(100dvh-4rem)]">
      <Suspense fallback={null}>
        <DashboardSettingsModalsHost />
      </Suspense>
      <PresencePane active={activePage === "dashboard"} label="Routing">
        <RoutingPane />
      </PresencePane>
      <PresencePane active={activePage === "activity"} label="Activity">
        <ActivityWorkspaceView />
      </PresencePane>
      <PresencePane active={activePage === "leads"} label="Leads">
        <LeadsWorkspaceView />
      </PresencePane>
      <PresencePane active={activePage === "contacts"} label="Team">
        <TeamWorkspaceView />
      </PresencePane>
      <PresencePane active={activePage === "pay"} label="Pay">
        <Suspense fallback={<div className="min-h-[40vh] w-full" aria-hidden />}>
          <PayWorkspaceView />
        </Suspense>
      </PresencePane>
      <PresencePane active={activePage === "settings"} label="Settings">
        <SettingsWorkspaceView />
      </PresencePane>
    </div>
  )
})
