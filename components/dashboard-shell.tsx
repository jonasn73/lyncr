"use client"

import { useCallback, useEffect, useMemo, useState, memo } from "react"
import { usePathname, useRouter } from "next/navigation"
import { AppShell, type AccountHeaderState, type PageId } from "@/components/app-shell"
import { DashboardChromeProvider } from "@/components/dashboard-shell-chrome-context"
import { DashboardNumbersModalProvider } from "@/components/dashboard-numbers-modal-context"
import { DashboardWorkspaceProvider } from "@/components/dashboard-workspace-context"
import { DashboardMainContent } from "@/components/dashboard-main-content"
import { AnsweredCallCustomerPopup } from "@/components/answered-call-customer-popup"

const VALID_PAGES: PageId[] = ["dashboard", "activity", "leads", "customers", "contacts", "pay", "settings", "help"]

function getActivePage(pathname: string): PageId {
  const segment = pathname.replace(/^\/dashboard\/?/, "").trim() || "dashboard"
  return VALID_PAGES.includes(segment as PageId) ? (segment as PageId) : "dashboard"
}

/** Popup enabled flag only — avoids passing full account object into memoized children. */
const DashboardAnsweredCallPopup = memo(function DashboardAnsweredCallPopup({
  enabled,
}: {
  enabled: boolean
}) {
  return <AnsweredCallCustomerPopup enabled={enabled} />
})

export function DashboardShell({
  children,
  pathnameFromRequest,
}: {
  children: React.ReactNode
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

  const popupEnabled = useMemo(
    () => accountHeader.kind === "ready" && accountHeader.answeredCallCustomerPopupEnabled,
    [accountHeader]
  )

  return (
    <DashboardChromeProvider activePage={activePage}>
      <DashboardWorkspaceProvider>
        <DashboardNumbersModalProvider>
          <AppShell pathname={pathname} accountHeader={accountHeader}>
            <DashboardMainContent activePage={activePage} routedChildren={children} />
            <DashboardAnsweredCallPopup enabled={popupEnabled} />
          </AppShell>
        </DashboardNumbersModalProvider>
      </DashboardWorkspaceProvider>
    </DashboardChromeProvider>
  )
}
