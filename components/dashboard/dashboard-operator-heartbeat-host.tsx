"use client"

// Keeps operator_dashboard_heartbeats fresh while the dashboard tab is visible.

import { useEffect } from "react"
import { useDashboardSessionOptional } from "@/components/dashboard-session-context"

/** Ping interval while the tab is visible (must stay under the 2-minute active window). */
const HEARTBEAT_MS = 45_000

export function DashboardOperatorHeartbeatHost() {
  // Session gives us companyUserId — only run when logged into the dashboard shell.
  const session = useDashboardSessionOptional()
  const companyUserId = session?.companyUserId?.trim() || ""

  useEffect(() => {
    // No session → nothing to heartbeat.
    if (!companyUserId) return

    // Fire one immediate ping, then on an interval while visible.
    const ping = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      void fetch("/api/operator/heartbeat", {
        method: "POST",
        credentials: "include",
      }).catch(() => {
        /* ignore network blips */
      })
    }

    ping()
    const id = window.setInterval(ping, HEARTBEAT_MS)

    // Re-ping when the user returns to this tab.
    const onVis = () => {
      if (document.visibilityState === "visible") ping()
    }
    document.addEventListener("visibilitychange", onVis)

    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [companyUserId])

  // Invisible host — no UI.
  return null
}
