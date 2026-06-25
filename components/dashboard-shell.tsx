"use client"

import { Suspense, useCallback, useEffect, useMemo, useState, memo } from "react"
import { usePathname, useRouter } from "next/navigation"
import { AppShell, type AccountHeaderState, type PageId } from "@/components/app-shell"
import { DashboardChromeProvider } from "@/components/dashboard-shell-chrome-context"
import { DashboardNumbersModalProvider } from "@/components/dashboard-numbers-modal-context"
import { UpgradeSubscriptionModal } from "@/components/upgrade-subscription-modal"
import { AddCarrierCreditModal } from "@/components/add-carrier-credit-modal"
import { DashboardWorkspaceProvider } from "@/components/dashboard-workspace-context"
import { DashboardBusinessNumbersSync } from "@/components/dashboard-business-numbers-sync"
import { DashboardLeadsPrefetch } from "@/components/dashboard-leads-prefetch"
import { SwrProvider } from "@/components/swr-provider"
import { DashboardMainContent } from "@/components/dashboard-main-content"
import { AnsweredCallCustomerPopup } from "@/components/answered-call-customer-popup"
import {
  DashboardActivationProvider,
  type DashboardActivationSeed,
} from "@/components/dashboard-activation-context"
import {
  DashboardHeaderWorkspace,
  DashboardOrganizationsBootstrap,
} from "@/components/dashboard-header-workspace"
import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"
import type { LeadsWorkspaceCache } from "@/lib/leads-cache"
import { LeadsWorkspaceInitialProvider } from "@/components/leads-workspace-initial-context"
import { DashboardBootstrapShellGate } from "@/components/dashboard-bootstrap-context"
import { DashboardMainStreamGate } from "@/components/dashboard-main-stream-gate"
import { DashboardSettingsModalsLazyHost } from "@/components/dashboard/settings-modals-lazy-host"
import {
  DashboardSessionProvider,
  type DashboardSessionSnapshot,
} from "@/components/dashboard-session-context"

const VALID_PAGES: PageId[] = ["dashboard", "activity", "leads", "customers", "contacts", "pay", "settings", "scheduler", "help"]

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
  sessionBusinessName,
  sessionAccount,
  initialBootstrap,
  initialLeadsCache,
}: {
  children: React.ReactNode
  pathnameFromRequest: string | null
  /** Shown in the header workspace slot while orgs stream in on hard refresh. */
  sessionBusinessName?: string
  /** Server-resolved routing bootstrap — matches SSR HTML to client on hard refresh. */
  initialBootstrap?: DashboardMainBootstrap | null
  /** Server-resolved leads for /dashboard/leads hard refresh. */
  initialLeadsCache?: LeadsWorkspaceCache | null
  /** Server session snapshot — avoids header width jump while /api/auth/session loads. */
  sessionAccount?: {
    name: string
    email: string
    companyUserId?: string
    hasActiveSubscription?: boolean
    answeredCallCustomerPopupEnabled?: boolean
    inboundReceptionistWhisperEnabled?: boolean
    isPlatformAdmin?: boolean
    adminNotificationPreferences?: DashboardSessionSnapshot["adminNotificationPreferences"]
  }
}) {
  const clientPathname = usePathname()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [accountHeader, setAccountHeader] = useState<AccountHeaderState>(() =>
    sessionAccount
      ? {
          kind: "ready",
          name: sessionAccount.name,
          email: sessionAccount.email,
          answeredCallCustomerPopupEnabled: sessionAccount.answeredCallCustomerPopupEnabled !== false,
        }
      : { kind: "loading" }
  )

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
    if (sessionAccount) return
    void refreshSession()
  }, [sessionAccount, refreshSession])

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

  const settingsSessionSeed = useMemo(
    () =>
      sessionAccount
        ? {
            name: sessionAccount.name,
            email: sessionAccount.email,
            businessName: sessionBusinessName?.trim() || "My Business",
            companyUserId: sessionAccount.companyUserId ?? "",
          }
        : undefined,
    [sessionAccount, sessionBusinessName]
  )

  const dashboardSession = useMemo((): DashboardSessionSnapshot | null => {
    if (!sessionAccount) return null
    return {
      name: sessionAccount.name,
      email: sessionAccount.email,
      companyUserId: sessionAccount.companyUserId,
      answeredCallCustomerPopupEnabled: sessionAccount.answeredCallCustomerPopupEnabled,
      inboundReceptionistWhisperEnabled: sessionAccount.inboundReceptionistWhisperEnabled,
      isPlatformAdmin: sessionAccount.isPlatformAdmin === true,
      adminNotificationPreferences: sessionAccount.isPlatformAdmin
        ? sessionAccount.adminNotificationPreferences
        : undefined,
    }
  }, [sessionAccount])

  const activationSeed = useMemo((): DashboardActivationSeed | undefined => {
    if (!initialBootstrap && sessionAccount?.hasActiveSubscription == null) return undefined
    const lineCarrierLive = initialBootstrap?.phoneLines.some((line) => line.status === "active") ?? false
    return {
      subscriptionActive: lineCarrierLive || sessionAccount?.hasActiveSubscription === true,
      lineCarrierLive,
    }
  }, [initialBootstrap, sessionAccount?.hasActiveSubscription])

  return (
    <Suspense fallback={null}>
      <DashboardSessionProvider session={dashboardSession}>
      <DashboardActivationProvider activationSeed={activationSeed}>
        <DashboardChromeProvider activePage={activePage}>
          <SwrProvider>
            <DashboardWorkspaceProvider initialBootstrap={initialBootstrap}>
              <DashboardBootstrapShellGate initialBootstrap={initialBootstrap}>
                <DashboardBusinessNumbersSync />
                <DashboardLeadsPrefetch />
                <DashboardOrganizationsBootstrap />
                <DashboardNumbersModalProvider>
                  <UpgradeSubscriptionModal />
                  <AddCarrierCreditModal />
                  <Suspense fallback={null}>
                    <DashboardSettingsModalsLazyHost sessionSeed={settingsSessionSeed} />
                  </Suspense>
                  <LeadsWorkspaceInitialProvider initial={initialLeadsCache}>
                    <AppShell
                      pathname={pathname}
                      accountHeader={accountHeader}
                      headerCenter={<DashboardHeaderWorkspace sessionBusinessName={sessionBusinessName} />}
                    >
                      <DashboardMainStreamGate activePage={activePage}>
                        <DashboardMainContent activePage={activePage} routedChildren={children} />
                      </DashboardMainStreamGate>
                      <DashboardAnsweredCallPopup enabled={popupEnabled} />
                    </AppShell>
                  </LeadsWorkspaceInitialProvider>
                </DashboardNumbersModalProvider>
              </DashboardBootstrapShellGate>
            </DashboardWorkspaceProvider>
          </SwrProvider>
        </DashboardChromeProvider>
      </DashboardActivationProvider>
      </DashboardSessionProvider>
    </Suspense>
  )
}
