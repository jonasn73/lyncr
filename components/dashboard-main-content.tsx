"use client"

import { memo, useEffect, useRef, useState, type ReactNode } from "react"
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
  // Only animate after the user changes tabs — never on hard refresh (opacity 0 → 1 blink).
  const prevPageRef = useRef(activePage)
  const [enterAnim, setEnterAnim] = useState(false)
  const isPresence = isDashboardPresencePage(activePage)

  useFlickerDebugLifecycle("DashboardMainContent", {
    activePage,
    isPresence,
    enterAnim,
    remountKey: isPresence ? "none" : activePage,
  })

  useEffect(() => {
    if (prevPageRef.current === activePage) return
    prevPageRef.current = activePage
    setEnterAnim(true)
  }, [activePage])

  if (isPresence) {
    return (
      // No enter animation on primary tabs — that opacity-0 → 1 read as a refresh flash.
      <DashboardPageView>
        {/* ssrActiveSlot is the statically imported page.tsx view for this URL. */}
        <DashboardPresenceHost activePage={activePage} ssrActiveSlot={routedChildren} />
      </DashboardPageView>
    )
  }

  return (
    <DashboardPageView animateEnter={enterAnim} key={activePage}>
      {routedChildren}
    </DashboardPageView>
  )
})
