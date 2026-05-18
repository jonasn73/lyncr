import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/server-session-user"
import { userMayAccessDashboard } from "@/lib/server-onboarding-guard"

export const dynamic = "force-dynamic"

/** Skip the wizard when checkout already finished (Neon `profiles` row). */
export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getSessionUser()
  if (user && (await userMayAccessDashboard(user))) {
    redirect("/dashboard")
  }
  return children
}
