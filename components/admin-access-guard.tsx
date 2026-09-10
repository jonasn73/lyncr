"use client"

// Layout already requires platform-admin access. This only redirects if the session later
// fails. Do not block first paint with a spinner — that flashed Home after a blank wait.

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export function AdminAccessGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/auth/session", { credentials: "include" })
        if (!res.ok) {
          if (!cancelled) router.replace("/dashboard")
          return
        }
        // operator_access is derived server-side from users.is_platform_admin (or the
        // admin@lyncr.app bootstrap) — see lib/platform-admin.ts globalPlatformSessionFields.
        // Checking that instead of re-deriving from email here means this guard stays correct
        // for any admin, not just the bootstrap one.
        // NOTE: it lives on data.user.operator_access, not data.operator_access (GET
        // /api/auth/session nests the whole session payload under `user`) — reading the wrong
        // level here always evaluated to false and sent every real admin bouncing to /dashboard,
        // which correctly sends them right back to /admin: an infinite redirect loop.
        const json = (await res.json()) as { data?: { user?: { email?: string; operator_access?: boolean } } }
        if (!json.data?.user?.operator_access) {
          console.warn(
            `[lyncr-admin] UNAUTHORIZED — "${json.data?.user?.email ?? "unknown"}" is not a platform admin; redirecting to /dashboard`
          )
          if (!cancelled) router.replace("/dashboard")
        }
      } catch {
        if (!cancelled) router.replace("/dashboard")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  return <>{children}</>
}
