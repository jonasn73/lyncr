import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { DashboardShell } from "@/components/dashboard-shell"
import { getSessionUser } from "@/lib/server-session-user"
import { isPlatformAdminUser } from "@/lib/platform-admin"
import { userMayAccessDashboard } from "@/lib/server-onboarding-guard"

export const dynamic = "force-dynamic"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getSessionUser()
  const h = await headers()
  const pathnameFromRequest = h.get("x-sigo-pathname")

  if (!user) {
    const next =
      pathnameFromRequest && pathnameFromRequest.startsWith("/dashboard")
        ? pathnameFromRequest
        : "/dashboard"
    redirect(`/login?next=${encodeURIComponent(next)}`)
  }
  if (isPlatformAdminUser(user)) {
    redirect("/admin")
  }

  const dashboardReady = await userMayAccessDashboard(user)
  if (!dashboardReady) {
    redirect("/onboarding")
  }

  return (
    <DashboardShell pathnameFromRequest={pathnameFromRequest}>
      {children}
    </DashboardShell>
  )
}
