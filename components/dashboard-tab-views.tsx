"use client"

import { memo, useEffect, useState, type ComponentType } from "react"
import type { PageId } from "@/components/app-shell"
import { cn } from "@/lib/utils"
import { ActivityWorkspaceView } from "@/components/workspace-views/activity-workspace-view"
import { LeadsWorkspaceView } from "@/components/workspace-views/leads-workspace-view"
import { TeamWorkspaceView } from "@/components/workspace-views/team-workspace-view"
import { PayWorkspaceView } from "@/components/workspace-views/pay-workspace-view"
import { SettingsWorkspaceView } from "@/components/workspace-views/settings-workspace-view"

/** Bottom-nav workspace tabs — kept mounted after first visit to avoid remount lag. */
export const WORKSPACE_TAB_IDS = ["activity", "leads", "contacts", "pay", "settings"] as const
export type WorkspaceTabId = (typeof WORKSPACE_TAB_IDS)[number]

const TAB_VIEWS: Record<WorkspaceTabId, ComponentType> = {
  activity: ActivityWorkspaceView,
  leads: LeadsWorkspaceView,
  contacts: TeamWorkspaceView,
  pay: PayWorkspaceView,
  settings: SettingsWorkspaceView,
}

export function isWorkspaceTab(page: PageId): page is WorkspaceTabId {
  return (WORKSPACE_TAB_IDS as readonly string[]).includes(page)
}

/**
 * Renders all visited workspace panels; only the active tab is visible.
 * Inactive panels stay mounted (hidden + inert) so tab switches do not remount/fetch.
 */
export const DashboardTabHost = memo(function DashboardTabHost({
  activeTab,
}: {
  activeTab: WorkspaceTabId
}) {
  const [visited, setVisited] = useState<Set<WorkspaceTabId>>(() => new Set([activeTab]))

  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(activeTab)) return prev
      const next = new Set(prev)
      next.add(activeTab)
      return next
    })
  }, [activeTab])

  return (
    <div className="relative w-full">
      {WORKSPACE_TAB_IDS.map((tab) => {
        if (!visited.has(tab)) return null
        const View = TAB_VIEWS[tab]
        const isActive = tab === activeTab
        return (
          <section
            key={tab}
            role="tabpanel"
            aria-label={tab}
            hidden={!isActive}
            inert={isActive ? undefined : true}
            className={cn("w-full", !isActive && "hidden")}
          >
            <View />
          </section>
        )
      })}
    </div>
  )
})

/** Route pages mount nothing — `DashboardShell` renders `DashboardTabHost` from the layout. */
export function DashboardTabView(_props: { tab: WorkspaceTabId }) {
  return null
}
