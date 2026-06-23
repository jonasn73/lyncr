"use client"

import type { ReactNode } from "react"

/** Bootstrap hydration moved to DashboardBootstrapShellGate — this is a passthrough. */
export function DashboardMainStreamGate({
  children,
}: {
  children: ReactNode
  activePage?: string
}) {
  return <>{children}</>
}
