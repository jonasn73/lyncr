"use client"

// Shell-level RealTimeStats — shares one metrics subscription across all dashboard tabs.

import { type ReactNode } from "react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useWorkspacePhoneLines } from "@/lib/hooks/use-workspace-phone-lines"
import { RealTimeStatsProvider } from "@/components/dashboard/real-time-stats-provider"

export function DashboardRealtimeStatsHost({ children }: { children: ReactNode }) {
  const { activeLine } = useDashboardWorkspace()
  // Same stabilized list as Lines UI — prefer fuller bootstrap over a one-DID chrome subset
  // so the “Live” ticker does not dip 2 → 1 → 2 on hard refresh.
  const lines = useWorkspacePhoneLines()
  return (
    <RealTimeStatsProvider businessNumbers={lines} activeLineE164={activeLine}>
      {children}
    </RealTimeStatsProvider>
  )
}
