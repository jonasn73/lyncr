"use client"

import { Suspense, useCallback, useEffect, useMemo, useState, memo } from "react"
import dynamic from "next/dynamic"
import { usePathname, useRouter } from "next/navigation"
import { AppShell, type AccountHeaderState, type PageId } from "@/components/app-shell"
import { DashboardChromeProvider } from "@/components/dashboard-shell-chrome-context"
import { DashboardNumbersModalProvider } from "@/components/dashboard-numbers-modal-context"
import { UpgradeSubscriptionModal } from "@/components/upgrade-subscription-modal"
import { AddCarrierCreditModal } from "@/components/add-carrier-credit-modal"
import { DashboardWorkspaceProvider } from "@/components/dashboard-workspace-context"
import { InboundCallPanelProvider } from "@/lib/inbound-call-panel-context"
import { LyncEngineProvider } from "@/lib/lync-engine-context"
import { DashboardRealtimeStatsHost } from "@/components/dashboard/dashboard-realtime-stats-host"
import { RealTimeStatsStubProvider } from "@/components/dashboard/real-time-stats-provider"
import { DashboardBusinessNumbersSync } from "@/components/dashboard-business-numbers-sync"
import { SwrProvider } from "@/components/swr-provider"
import { DashboardMainContent } from "@/components/dashboard-main-content"
import { PhotoUploadNotificationBanner } from "@/components/dashboard/photo-upload-notification-banner"
import { SupportChatReplyBanner } from "@/components/dashboard/support-chat-reply-banner"
import { OwnerHelpSheet } from "@/components/owner-help-sheet"
import { DashboardOperatorHeartbeatHost } from "@/components/dashboard/dashboard-operator-heartbeat-host"
import { DeferredShellHost } from "@/components/dashboard/deferred-shell-host"
import {
  DashboardActivationProvider,
  type DashboardActivationSeed,
} from "@/components/dashboard-activation-context"
import {
  DashboardHeaderWorkspace,
  DashboardOrganizationsBootstrap,
} from "@/components/dashboard-header-workspace"
import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"
import { DashboardBootstrapShellGate } from "@/components/dashboard-bootstrap-context"
import { DashboardMainStreamGate } from "@/components/dashboard-main-stream-gate"
import { DashboardSettingsModalsLazyHost } from "@/components/dashboard/settings-modals-lazy-host"
import {
  DashboardSessionProvider,
  type DashboardSessionSnapshot,
  useDashboardSessionOptional,
} from "@/components/dashboard-session-context"
import { DispatchCommandBridgeProvider } from "@/lib/dispatch-command-bridge"
import { ErrorBoundary } from "@/components/error-boundary"
import {
  DashboardPaintSeedsProvider,
  type DashboardPaintSeeds,
} from "@/lib/dashboard-paint-seeds"

/**
 * Realtime hosts: LyncEngine, live stats, operator heartbeat, photo banner,
 * and CallAnsweredModal (intake sheet on inbound ring via Pusher).
 * Was temporarily false during React #185 triage; Radix Switch fix (773d798)
 * was the real loop — keep hosts on so call intake can open.
 */
const ENABLE_DASHBOARD_REALTIME_HOSTS = true

// Keep the heavy intake modal (Leaflet, framer-motion, ~4k LOC) out of the shell chunk.
const CallAnsweredModal = dynamic(
  () =>
    import("@/components/dashboard/CallAnsweredModal").then((m) => m.CallAnsweredModal),
  { ssr: false }
)

const VALID_PAGES: PageId[] = [
  "dashboard",
  "activity",
  "messages",
  "customers",
  "contacts",
  "pay",
  "settings",
  "scheduler",
  "inventory",
  "team",
  "help",
]

function getActivePage(pathname: string): PageId {
  const segment = pathname.replace(/^\/dashboard\/?/, "").trim() || "dashboard"
  // Old /dashboard/leads bookmarks → CRM pane (hard nav also redirects via leads/page.tsx).
  if (segment === "leads" || segment.startsWith("leads/")) return "customers"
  return VALID_PAGES.includes(segment as PageId) ? (segment as PageId) : "dashboard"
}

const DashboardAnsweredCallPopup = memo(function DashboardAnsweredCallPopup({
  enabled,
}: {
  enabled: boolean
}) {
  const session = useDashboardSessionOptional()
  return <CallAnsweredModal enabled={enabled} ownerUserId={session?.companyUserId ?? null} />
})

export function DashboardShell({
  children,
  pathnameFromRequest,
  sessionBusinessName,
  sessionAccount,
  initialBootstrap,
  initialActiveOrganizationId = null,
  paintSeeds = null,
}: {
  children: React.ReactNode
  pathnameFromRequest: string | null
  /** Shown in the header workspace slot while orgs stream in on hard refresh. */
  sessionBusinessName?: string
  /** Server-resolved routing bootstrap — matches SSR HTML to client on hard refresh. */
  initialBootstrap?: DashboardMainBootstrap | null
  /** Cookie-backed active org — keeps business name stable across SSR → hydrate. */
  initialActiveOrganizationId?: string | null
  /** Cookie paint seeds so wallet/telemetry/Latest SSR matches warm session. */
  paintSeeds?: DashboardPaintSeeds | null
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
    // Always listen for inbound rings so New Intake can open live — preference only
    // gated the sheet historically; operators need the modal on every incoming call.
    () => accountHeader.kind === "ready",
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
    const linesPaint = paintSeeds?.lines
    const lineCarrierLive =
      initialBootstrap?.phoneLines.some((line) => line.status === "active") === true ||
      linesPaint?.lineCarrierLive === true ||
      linesPaint?.lines.some((line) => line.status === "active" || line.carrier_live === true) === true
    if (!initialBootstrap && sessionAccount?.hasActiveSubscription == null && !linesPaint) {
      return undefined
    }
    return {
      subscriptionActive:
        lineCarrierLive ||
        linesPaint?.subscriptionActive === true ||
        sessionAccount?.hasActiveSubscription === true,
      lineCarrierLive,
    }
  }, [initialBootstrap, sessionAccount?.hasActiveSubscription, paintSeeds?.lines])

  return (
    <ErrorBoundary>
      <DashboardPaintSeedsProvider seeds={paintSeeds}>
      <DashboardSessionProvider session={dashboardSession}>
      <DashboardActivationProvider activationSeed={activationSeed}>
        <DashboardChromeProvider activePage={activePage}>
          <SwrProvider>
            <DashboardWorkspaceProvider
              initialBootstrap={initialBootstrap}
              initialActiveOrganizationId={initialActiveOrganizationId}
              paintSeeds={paintSeeds}
            >
              {ENABLE_DASHBOARD_REALTIME_HOSTS ? (
              <LyncEngineProvider>
              <DashboardRealtimeStatsHost>
              <InboundCallPanelProvider>
              <DashboardBootstrapShellGate initialBootstrap={initialBootstrap}>
                <DashboardBusinessNumbersSync />
                <DashboardOrganizationsBootstrap />
                <DashboardNumbersModalProvider>
                  <UpgradeSubscriptionModal />
                  <AddCarrierCreditModal />
                  <Suspense fallback={null}>
                    <DashboardSettingsModalsLazyHost sessionSeed={settingsSessionSeed} />
                  </Suspense>
                  <DispatchCommandBridgeProvider>
                    <AppShell
                      pathname={pathname}
                      accountHeader={accountHeader}
                      headerCenter={<DashboardHeaderWorkspace sessionBusinessName={sessionBusinessName} />}
                    >
                      <DashboardMainStreamGate activePage={activePage}>
                        <DashboardMainContent activePage={activePage} routedChildren={children} />
                      </DashboardMainStreamGate>
                      {/* Heartbeat + photo toast are non-critical — idle-defer so tab refresh paints first. */}
                      <DeferredShellHost>
                        <DashboardOperatorHeartbeatHost />
                        <PhotoUploadNotificationBanner />
                        <SupportChatReplyBanner />
                        <OwnerHelpSheet />
                      </DeferredShellHost>
                    </AppShell>
                    {/* Intake must stay mounted with LyncEngine — do not defer this popup. */}
                    <DashboardAnsweredCallPopup enabled={popupEnabled} />
                  </DispatchCommandBridgeProvider>
                </DashboardNumbersModalProvider>
              </DashboardBootstrapShellGate>
              </InboundCallPanelProvider>
              </DashboardRealtimeStatsHost>
              </LyncEngineProvider>
              ) : (
              <RealTimeStatsStubProvider>
              <InboundCallPanelProvider>
              <DashboardBootstrapShellGate initialBootstrap={initialBootstrap}>
                <DashboardBusinessNumbersSync />
                <DashboardOrganizationsBootstrap />
                <DashboardNumbersModalProvider>
                  <UpgradeSubscriptionModal />
                  <AddCarrierCreditModal />
                  <Suspense fallback={null}>
                    <DashboardSettingsModalsLazyHost sessionSeed={settingsSessionSeed} />
                  </Suspense>
                  <DispatchCommandBridgeProvider>
                    <AppShell
                      pathname={pathname}
                      accountHeader={accountHeader}
                      headerCenter={<DashboardHeaderWorkspace sessionBusinessName={sessionBusinessName} />}
                    >
                      <DashboardMainStreamGate activePage={activePage}>
                        <DashboardMainContent activePage={activePage} routedChildren={children} />
                      </DashboardMainStreamGate>
                      <SupportChatReplyBanner />
                      <OwnerHelpSheet />
                    </AppShell>
                  </DispatchCommandBridgeProvider>
                </DashboardNumbersModalProvider>
              </DashboardBootstrapShellGate>
              </InboundCallPanelProvider>
              </RealTimeStatsStubProvider>
              )}
            </DashboardWorkspaceProvider>
          </SwrProvider>
        </DashboardChromeProvider>
      </DashboardActivationProvider>
      </DashboardSessionProvider>
      </DashboardPaintSeedsProvider>
    </ErrorBoundary>
  )
}
