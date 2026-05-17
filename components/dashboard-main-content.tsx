"use client"

import { memo, type ReactNode } from "react"
import type { PageId } from "@/components/app-shell"
import { DashboardPageView } from "@/components/dashboard-page-view"
import {
  DashboardPresenceHost,
  isDashboardPresencePage,
} from "@/components/dashboard-presence-host"

/**
 * Main column: presence host for primary tabs (no mount/unmount on navigation).
 * Secondary routes (help, customers, …) still use server children.
 */
export const DashboardMainContent = memo(function DashboardMainContent({
  activePage,
  routedChildren,
}: {
  activePage: PageId
  routedChildren: ReactNode
}) {
  if (isDashboardPresencePage(activePage)) {
    return (
      <DashboardPageView>
        <DashboardPresenceHost activePage={activePage} />
      </DashboardPageView>
    )
  }

  return <DashboardPageView animateEnter>{routedChildren}</DashboardPageView>
})
