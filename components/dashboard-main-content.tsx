"use client"

import { memo, useEffect, useRef, useState, type ReactNode } from "react"
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
  // Only animate after the user changes tabs — never on hard refresh (opacity 0 → 1 blink).
  const prevPageRef = useRef(activePage)
  const [enterAnim, setEnterAnim] = useState(false)

  useEffect(() => {
    if (prevPageRef.current === activePage) return
    prevPageRef.current = activePage
    setEnterAnim(true)
  }, [activePage])

  if (isDashboardPresencePage(activePage)) {
    return (
      <DashboardPageView>
        <DashboardPresenceHost activePage={activePage} />
      </DashboardPageView>
    )
  }

  return (
    <DashboardPageView animateEnter={enterAnim} key={activePage}>
      {routedChildren}
    </DashboardPageView>
  )
})
