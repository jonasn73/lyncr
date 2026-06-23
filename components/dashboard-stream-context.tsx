"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import type { ActivePipelineJob, UnassignedPoolJob } from "@/lib/types"

type DashboardStreamContextValue = {
  phoneLinesPromise?: Promise<DashboardBusinessNumber[]>
  jobPoolPromise?: Promise<UnassignedPoolJob[]>
  activePipelinePromise?: Promise<ActivePipelineJob[]>
}

const DashboardStreamContext = createContext<DashboardStreamContextValue>({})

export function DashboardStreamProvider({
  phoneLinesPromise,
  jobPoolPromise,
  activePipelinePromise,
  children,
}: DashboardStreamContextValue & { children: ReactNode }) {
  return (
    <DashboardStreamContext.Provider
      value={{ phoneLinesPromise, jobPoolPromise, activePipelinePromise }}
    >
      {children}
    </DashboardStreamContext.Provider>
  )
}

export function useDashboardStream(): DashboardStreamContextValue {
  return useContext(DashboardStreamContext)
}
