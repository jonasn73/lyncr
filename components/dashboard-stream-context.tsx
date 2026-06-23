"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import type { DashboardRoutingBootstrap } from "@/lib/dashboard-stream-types"
import type { ActivePipelineJob, Organization, UnassignedPoolJob } from "@/lib/types"

type DashboardStreamContextValue = {
  phoneLinesPromise?: Promise<DashboardBusinessNumber[]>
  routingBootstrapPromise?: Promise<DashboardRoutingBootstrap>
  organizationsPromise?: Promise<Organization[]>
  jobPoolPromise?: Promise<UnassignedPoolJob[]>
  activePipelinePromise?: Promise<ActivePipelineJob[]>
}

const DashboardStreamContext = createContext<DashboardStreamContextValue>({})

export function DashboardStreamProvider({
  phoneLinesPromise,
  routingBootstrapPromise,
  organizationsPromise,
  jobPoolPromise,
  activePipelinePromise,
  children,
}: DashboardStreamContextValue & { children: ReactNode }) {
  return (
    <DashboardStreamContext.Provider
      value={{
        phoneLinesPromise,
        routingBootstrapPromise,
        organizationsPromise,
        jobPoolPromise,
        activePipelinePromise,
      }}
    >
      {children}
    </DashboardStreamContext.Provider>
  )
}

export function useDashboardStream(): DashboardStreamContextValue {
  return useContext(DashboardStreamContext)
}
