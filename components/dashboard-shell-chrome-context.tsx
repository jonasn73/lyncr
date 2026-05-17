"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { PageId } from "@/components/app-shell"

const ActivePageContext = createContext<PageId>("dashboard")

/** Lets bottom nav read active tab without re-rendering main content children. */
export function DashboardChromeProvider({
  activePage,
  children,
}: {
  activePage: PageId
  children: ReactNode
}) {
  return <ActivePageContext.Provider value={activePage}>{children}</ActivePageContext.Provider>
}

export function useDashboardActivePage(): PageId {
  return useContext(ActivePageContext)
}
