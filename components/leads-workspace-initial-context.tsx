"use client"

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react"
import { readLeadsWorkspaceCache, type LeadsWorkspaceCache } from "@/lib/leads-cache"

const LeadsWorkspaceInitialContext = createContext<LeadsWorkspaceCache | null>(null)

export function LeadsWorkspaceInitialProvider({
  initial,
  children,
}: {
  initial?: LeadsWorkspaceCache | null
  children: ReactNode
}) {
  return (
    <LeadsWorkspaceInitialContext.Provider value={initial ?? null}>
      {children}
    </LeadsWorkspaceInitialContext.Provider>
  )
}

export function useLeadsWorkspaceInitial(): LeadsWorkspaceCache | null {
  return useContext(LeadsWorkspaceInitialContext)
}

/** Session cache readable on the client's first paint (fixes SSR hydration starting with loading=true). */
export function useLeadsWorkspaceCacheSnapshot(): LeadsWorkspaceCache | undefined {
  return useSyncExternalStore(
    () => () => {},
    () => readLeadsWorkspaceCache(),
    () => undefined
  )
}
