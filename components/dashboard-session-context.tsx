"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { AdminNotificationPreferences } from "@/lib/types"

/** Server-hydrated account snapshot — available on first paint after dashboard layout auth. */
export type DashboardSessionSnapshot = {
  name: string
  email: string
  companyUserId?: string
  answeredCallCustomerPopupEnabled?: boolean
  inboundReceptionistWhisperEnabled?: boolean
  /** Present only when the signed-in user has is_platform_admin = true. */
  isPlatformAdmin?: boolean
  adminNotificationPreferences?: AdminNotificationPreferences
}

const DashboardSessionContext = createContext<DashboardSessionSnapshot | null>(null)

export function DashboardSessionProvider({
  session,
  children,
}: {
  session: DashboardSessionSnapshot | null
  children: ReactNode
}) {
  return <DashboardSessionContext.Provider value={session}>{children}</DashboardSessionContext.Provider>
}

export function useDashboardSessionOptional(): DashboardSessionSnapshot | null {
  return useContext(DashboardSessionContext)
}
