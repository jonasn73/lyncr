import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/server-session-user"
import { userMayAccessDashboard } from "@/lib/server-onboarding-guard"
import { getUserAccountStatus } from "@/lib/db"
import { accountWaitPath } from "@/lib/account-status"

export const dynamic = "force-dynamic"

/** Skip the wizard when checkout already finished (Neon `onboarding_profiles` row). */
export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getSessionUser()
  if (user) {
    const wait = accountWaitPath(await getUserAccountStatus(user.id))
    if (wait) redirect(wait)
  }
  if (user && (await userMayAccessDashboard(user))) {
    redirect("/dashboard")
  }
  return children
}
