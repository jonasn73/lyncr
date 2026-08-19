"use client"

// Layout already requires admin@lyncr.app. This only redirects if the session later fails.
// Do not block first paint with a spinner — that flashed Home after a blank wait.

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { isLyncrAdminEmail, LYNCR_ADMIN_EMAIL } from "@/lib/lyncr-admin"

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
        const json = (await res.json()) as { data?: { user?: { email?: string } } }
        const email = json.data?.user?.email ?? ""
        if (!isLyncrAdminEmail(email)) {
          console.warn(
            `[lyncr-admin] UNAUTHORIZED — expected ${LYNCR_ADMIN_EMAIL}, got "${email}"; redirecting to /dashboard`
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
