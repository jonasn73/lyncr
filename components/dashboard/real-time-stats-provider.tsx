"use client"

// React context so the telemetry strip and call-flow header share one metrics source.

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { useRealTimeStats, type UseRealTimeStatsResult } from "@/lib/hooks/use-real-time-stats"

const RealTimeStatsContext = createContext<UseRealTimeStatsResult | null>(null)

const EMPTY_STATS: UseRealTimeStatsResult = {
  dailyCalls: 0,
  missedCalls: 0,
  holdPathCalls: 0,
  dailyTalkSeconds: 0,
  weeklyTalkSeconds: 0,
  monthlyTalkSeconds: 0,
  liveDailyTalkSeconds: 0,
  liveWeeklyTalkSeconds: 0,
  liveMonthlyTalkSeconds: 0,
  bookingRatePercent: 0,
  avgDispatchSpeedMinutes: null,
  rescueRevenueCents: 0,
  liveLineCount: 0,
  activeCallsOnSelectedLine: 0,
  activeCallSessions: [],
  realtimeConnected: false,
  baselineReady: false,
  refreshBaseline: async () => {},
}

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

/** Zeroed provider — Lines can render without mounting live Pusher stats hooks. */
export function RealTimeStatsStubProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => EMPTY_STATS, [])
  return <RealTimeStatsContext.Provider value={value}>{children}</RealTimeStatsContext.Provider>
}

/** Read shared live call metrics — falls back to zeros if provider is missing (safe mode). */
export function useRealTimeStatsContext(): UseRealTimeStatsResult {
  const ctx = useContext(RealTimeStatsContext)
  // Never throw — missing provider used to crash /dashboard (and can flash into #185 recovery).
  return ctx ?? EMPTY_STATS
}

/** Optional read when provider is absent (returns null instead of throwing). */
export function useRealTimeStatsContextOptional(): UseRealTimeStatsResult | null {
  return useContext(RealTimeStatsContext)
}
