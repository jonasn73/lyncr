import { redirect } from "next/navigation"
import { Suspense } from "react"
import { cookies, headers } from "next/headers"
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/workspace-organizations"
import { readDashboardPaintSeedsFromCookies } from "@/lib/dashboard-paint-seeds-server"
import {
  VIEWPORT_COOKIE,
  VIEWPORT_MOBILE_HEADER,
  parseViewportIsMobile,
} from "@/lib/viewport-hint"
import { DashboardShell } from "@/components/dashboard-shell"
import { DashboardStreamProvider } from "@/components/dashboard-stream-context"
import { isSandboxTestReceptionistEmail } from "@/lib/receptionist-portal-auth"
import { getCachedSessionUser } from "@/lib/server/cached-session"
import { isPlatformAdminUser } from "@/lib/platform-admin"
import { getUserAccountStatus } from "@/lib/db"
import { accountWaitPath } from "@/lib/account-status"
import { resolveAdminNotificationPreferences } from "@/lib/admin-notification-preferences"
import { userMayAccessDashboard } from "@/lib/server-onboarding-guard"
import {
  activePipelinePromise,
  dashboardMainBootstrapPromise,
  jobPoolPromise,
  organizationsPromise,
  phoneLinesPromise,
  routingBootstrapPromise,
} from "@/lib/server/streamed-dashboard-data"
import type { User } from "@/lib/types"

export const dynamic = "force-dynamic"

async function DashboardOnboardingGuard({ user }: { user: User }) {
  let dashboardReady = false
  try {
    dashboardReady = await userMayAccessDashboard(user)
  } catch (e) {
    console.error("[dashboard/layout] onboarding guard", e)
  }
  if (!dashboardReady) redirect("/onboarding")
  return null
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [user, h, cookieStore] = await Promise.all([getCachedSessionUser(), headers(), cookies()])
  const pathnameFromRequest = h.get("x-sigo-pathname")
  const initialActiveOrganizationId =
    cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value?.trim() || null

  // Cookie paint seeds — SSR HTML can match last-known wallet / telemetry / Latest / Pay.
  const paintSeeds = readDashboardPaintSeedsFromCookies((name) => cookieStore.get(name)?.value)
  const initialIsMobile = parseViewportIsMobile(
    cookieStore.get(VIEWPORT_COOKIE)?.value,
    h.get("sec-ch-ua-mobile") ??
      (h.get(VIEWPORT_MOBILE_HEADER) === "1"
        ? "?1"
        : h.get(VIEWPORT_MOBILE_HEADER) === "0"
          ? "?0"
          : null),
    h.get("sec-ch-viewport-width")
  )

  const isSecondaryDashboardRoute =
    pathnameFromRequest === "/dashboard/help" ||
    pathnameFromRequest?.startsWith("/dashboard/help/") ||
    pathnameFromRequest === "/dashboard/customers" ||
    pathnameFromRequest?.startsWith("/dashboard/customers/") ||
    pathnameFromRequest === "/dashboard/inventory" ||
    pathnameFromRequest?.startsWith("/dashboard/inventory/")
  const isDashboardShellRoute =
    !pathnameFromRequest ||
    pathnameFromRequest === "/dashboard" ||
    pathnameFromRequest.startsWith("/dashboard/")
  const shouldStreamMainBootstrap = isDashboardShellRoute && !isSecondaryDashboardRoute
  const isMainRoutingDashboard =
    !pathnameFromRequest ||
    pathnameFromRequest === "/dashboard" ||
    pathnameFromRequest === "/dashboard/"

  if (!user) {
    const next =
      pathnameFromRequest && pathnameFromRequest.startsWith("/dashboard")
        ? pathnameFromRequest
        : "/dashboard"
    redirect(`/login?next=${encodeURIComponent(next)}`)
  }
  if (user.account_role === "receptionist") redirect("/receptionist")
  if (user.account_role === "field_tech") redirect("/tech/dashboard")
  if (isSandboxTestReceptionistEmail(user.email)) {
    redirect("/receptionist/training/automotive_core")
  }
  if (isPlatformAdminUser(user)) redirect("/admin")

  const wait = accountWaitPath(await getUserAccountStatus(user.id))
  if (wait) redirect(wait)

  // Do not await bootstrap here — it blocked TTFB on every /dashboard load.
  // Client paints from session seed; these promises stream into the shell.
  const mainBootstrapPromise = shouldStreamMainBootstrap ? dashboardMainBootstrapPromise(user) : undefined
  const linesPromise = mainBootstrapPromise
    ? mainBootstrapPromise.then((b) => b.phoneLines)
    : phoneLinesPromise(user)
  const routingPromise = mainBootstrapPromise
    ? mainBootstrapPromise.then((b) => b.routing)
    : isMainRoutingDashboard
      ? routingBootstrapPromise(user)
      : undefined
  const orgsPromise = mainBootstrapPromise
    ? mainBootstrapPromise.then((b) => b.organizations)
    : organizationsPromise(user)
  const hopperPromise = shouldStreamMainBootstrap ? jobPoolPromise(user) : undefined
  const pipelinePromise = shouldStreamMainBootstrap ? activePipelinePromise(user) : undefined

  return (
    <DashboardStreamProvider
      dashboardMainBootstrapPromise={mainBootstrapPromise}
      phoneLinesPromise={linesPromise}
      routingBootstrapPromise={routingPromise}
      organizationsPromise={orgsPromise}
      jobPoolPromise={hopperPromise}
      activePipelinePromise={pipelinePromise}
    >
      <DashboardShell
        pathnameFromRequest={pathnameFromRequest}
        sessionBusinessName={user.business_name}
        initialBootstrap={null}
        initialActiveOrganizationId={initialActiveOrganizationId}
        paintSeeds={paintSeeds}
        initialIsMobile={initialIsMobile}
        // Keep the guard out of `children` so the active tab slot is only the page view.
        onboardingGuard={
          <Suspense fallback={null}>
            <DashboardOnboardingGuard user={user} />
          </Suspense>
        }
        sessionAccount={{
          name: user.name?.trim() || "Account",
          email: user.email,
          companyUserId: user.id,
          hasActiveSubscription: user.has_active_subscription === true,
          answeredCallCustomerPopupEnabled: user.answered_call_customer_popup_enabled !== false,
          inboundReceptionistWhisperEnabled: user.inbound_receptionist_whisper_enabled !== false,
          ...(user.is_platform_admin
            ? {
                isPlatformAdmin: true as const,
                adminNotificationPreferences: resolveAdminNotificationPreferences(user),
              }
            : {}),
        }}
      >
        {children}
      </DashboardShell>
    </DashboardStreamProvider>
  )
}
