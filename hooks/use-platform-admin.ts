"use client"

import { useEffect, useState } from "react"
import { isGlobalPlatformAdmin } from "@/lib/platform-admin"

/** Loads the core platform session and reports global super-admin status. */
export function usePlatformAdmin() {
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/session", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (json: {
          data?: {
            user?: { email?: string; globalRole?: string | null; isPlatformAdmin?: boolean }
          }
        } | null) => {
          if (cancelled) return
          setIsPlatformAdmin(isGlobalPlatformAdmin(json?.data?.user))
        }
      )
      .catch(() => {
        if (!cancelled) setIsPlatformAdmin(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { isPlatformAdmin, loading }
}
