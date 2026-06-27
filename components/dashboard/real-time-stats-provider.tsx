"use client"

// React context so the telemetry strip and call-flow header share one Pusher subscription.

import { createContext, useContext, type ReactNode } from "react"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { useRealTimeStats, type UseRealTimeStatsResult } from "@/lib/hooks/use-real-time-stats"

const RealTimeStatsContext = createContext<UseRealTimeStatsResult | null>(null)

export function RealTimeStatsProvider({
  businessNumbers,
  activeLineE164,
  children,
}: {
  businessNumbers: DashboardBusinessNumber[]
  activeLineE164?: string | null
  children: ReactNode
}) {
  const stats = useRealTimeStats({ businessNumbers, activeLineE164 })
  return <RealTimeStatsContext.Provider value={stats}>{children}</RealTimeStatsContext.Provider>
}

/** Read shared live call metrics (must sit under RealTimeStatsProvider). */
export function useRealTimeStatsContext(): UseRealTimeStatsResult {
  const ctx = useContext(RealTimeStatsContext)
  if (!ctx) {
    throw new Error("useRealTimeStatsContext must be used within RealTimeStatsProvider")
  }
  return ctx
}

/** Optional read when provider is absent (returns null instead of throwing). */
export function useRealTimeStatsContextOptional(): UseRealTimeStatsResult | null {
  return useContext(RealTimeStatsContext)
}
