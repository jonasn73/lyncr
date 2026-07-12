"use client"

// Shell-level RealTimeStats — shares one metrics subscription across all dashboard tabs.

import { type ReactNode } from "react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { RealTimeStatsProvider } from "@/components/dashboard/real-time-stats-provider"

export function DashboardRealtimeStatsHost({ children }: { children: ReactNode }) {
  const { businessNumbers, activeLine } = useDashboardWorkspace()
  return (
    <RealTimeStatsProvider businessNumbers={businessNumbers} activeLineE164={activeLine}>
      {children}
    </RealTimeStatsProvider>
  )
}
