"use client"

import { useEffect } from "react"
import { refreshLeadsWorkspaceCache } from "@/lib/leads-cache"

/** Warm leads in sessionStorage while the user is on other tabs — avoids spinner on first Leads visit. */
export function DashboardLeadsPrefetch() {
  useEffect(() => {
    let cancelled = false
    void refreshLeadsWorkspaceCache().catch(() => {
      if (!cancelled) {
        /* ignore — Leads tab will retry */
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return null
}
