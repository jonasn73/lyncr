"use client"

import { memo, type ReactNode } from "react"
import type { PageId } from "@/components/app-shell"
import { DashboardPageView } from "@/components/dashboard-page-view"
import {
  DashboardPresenceHost,
  isDashboardPresencePage,
} from "@/components/dashboard-presence-host"
import { useFlickerDebugLifecycle } from "@/lib/debug/flicker-debug"

/**
 * Main column: presence host for primary tabs (no mount/unmount on navigation).
 * Secondary routes (help, inventory, …) still use server children.
 */
export const DashboardMainContent = memo(function DashboardMainContent({
  activePage,
  routedChildren,
}: {
  activePage: PageId
  routedChildren: ReactNode
}) {
  const isPresence = isDashboardPresencePage(activePage)

  useFlickerDebugLifecycle("DashboardMainContent", {
    activePage,
    isPresence,
    remountKey: isPresence ? "none" : activePage,
  })

  if (isPresence) {
    return (
      // No enter animation on primary tabs — that opacity-0 → 1 read as a refresh flash.
      <DashboardPageView>
        {/* ssrActiveSlot is the statically imported page.tsx view for this URL. */}
        <DashboardPresenceHost activePage={activePage} ssrActiveSlot={routedChildren} />
      </DashboardPageView>
    )
  }

  // Soft settle on secondary routes only — never opacity-0 enter (looked like a refresh flash).
  return (
    <DashboardPageView key={activePage} softEnter>
      {routedChildren}
    </DashboardPageView>
  )
})
