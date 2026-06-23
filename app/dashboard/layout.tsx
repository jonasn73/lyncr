import { redirect } from "next/navigation"
import { Suspense } from "react"
import { headers } from "next/headers"
import { DashboardShell } from "@/components/dashboard-shell"
import { DashboardStreamProvider } from "@/components/dashboard-stream-context"
import { isSandboxTestReceptionistEmail } from "@/lib/receptionist-portal-auth"
import { getCachedSessionUser } from "@/lib/server/cached-session"
import { isPlatformAdminUser } from "@/lib/platform-admin"
import { userMayAccessDashboard } from "@/lib/server-onboarding-guard"
import {
  activePipelinePromise,
  jobPoolPromise,
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
  const [user, h] = await Promise.all([getCachedSessionUser(), headers()])
  const pathnameFromRequest = h.get("x-sigo-pathname")
  const isSchedulerRoute = pathnameFromRequest?.startsWith("/dashboard/scheduler") ?? false
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

  const linesPromise = phoneLinesPromise(user)
  const routingPromise = isMainRoutingDashboard ? routingBootstrapPromise(user) : undefined
  const hopperPromise = isSchedulerRoute ? jobPoolPromise(user) : undefined
  const pipelinePromise = isSchedulerRoute ? activePipelinePromise(user) : undefined

  return (
    <DashboardStreamProvider
      phoneLinesPromise={linesPromise}
      routingBootstrapPromise={routingPromise}
      jobPoolPromise={hopperPromise}
      activePipelinePromise={pipelinePromise}
    >
      <DashboardShell pathnameFromRequest={pathnameFromRequest}>
        <Suspense fallback={null}>
          <DashboardOnboardingGuard user={user} />
        </Suspense>
        {children}
      </DashboardShell>
    </DashboardStreamProvider>
  )
}
