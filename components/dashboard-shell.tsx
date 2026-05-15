"use client"

// ============================================
// Client chrome for /dashboard/* (nav + session check).
// ============================================
// `pathnameFromRequest` comes from middleware (x-sigo-pathname) via the server
// layout. Until the client has mounted, we use that for the active tab + Link
// context so the shell never briefly disagrees with the real URL during hydration.

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { AppShell, type AccountHeaderState, type PageId } from "@/components/app-shell"
import { DashboardPageView } from "@/components/dashboard-page-view"
import { AnsweredCallCustomerPopup } from "@/components/answered-call-customer-popup"

const VALID_PAGES: PageId[] = ["dashboard", "activity", "leads", "customers", "contacts", "analytics", "settings", "help"]

function getActivePage(pathname: string): PageId {
  const segment = pathname.replace(/^\/dashboard\/?/, "").trim() || "dashboard"
  return VALID_PAGES.includes(segment as PageId) ? (segment as PageId) : "dashboard"
}

export function DashboardShell({
  children,
  pathnameFromRequest,
}: {
  children: React.ReactNode
  /** Set from middleware request header — authoritative on first paint */
  pathnameFromRequest: string | null
}) {
  const clientPathname = usePathname()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [accountHeader, setAccountHeader] = useState<AccountHeaderState>({ kind: "loading" })

  useEffect(() => {
    setMounted(true)
  }, [])

  const refreshSession = useCallback(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401 || !res.ok) {
          router.replace("/login")
          return
        }
        const data = await res.json().catch(() => ({}))
        const u = data?.data?.user
        if (u?.email) {
          setAccountHeader({
            kind: "ready",
            name: String(u.name ?? "Account"),
            email: String(u.email),
            answeredCallCustomerPopupEnabled: u.answered_call_customer_popup_enabled !== false,
          })
        } else {
          router.replace("/login")
        }
      })
      .catch(() => router.replace("/login"))
  }, [router])

  useEffect(() => {
    void refreshSession()
  }, [refreshSession])

  useEffect(() => {
    const onUpdated = () => void refreshSession()
    window.addEventListener("zing-account-preferences-updated", onUpdated)
    return () => window.removeEventListener("zing-account-preferences-updated", onUpdated)
  }, [refreshSession])

  // Before mount: middleware `x-sigo-pathname` matches the real URL on first paint (good for refresh).
  // After mount: use Next’s `usePathname()` — it updates with the App Router as soon as the route
  // commits. `window.location.pathname` often updates *later* on client navigations, so preferring
  // it made the highlight stay on the old tab while the new page was already showing.
  const pathname = useMemo(() => {
    if (!mounted && pathnameFromRequest != null && pathnameFromRequest.startsWith("/dashboard")) {
      return pathnameFromRequest
    }
    if (clientPathname.startsWith("/dashboard")) {
      return clientPathname
    }
    if (pathnameFromRequest && pathnameFromRequest.startsWith("/dashboard")) {
      return pathnameFromRequest
    }
    return "/dashboard"
  }, [mounted, pathnameFromRequest, clientPathname])

  const activePage = getActivePage(pathname)

  return (
    <AppShell activePage={activePage} pathname={pathname} accountHeader={accountHeader}>
      <DashboardPageView pathname={pathname}>{children}</DashboardPageView>
      <AnsweredCallCustomerPopup
        enabled={
          accountHeader.kind === "ready" && accountHeader.answeredCallCustomerPopupEnabled
        }
      />
    </AppShell>
  )
}
