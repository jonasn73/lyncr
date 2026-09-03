// Tech console — Performance tab: earned/locked achievement badges.

import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/server-session-user"
import { getFieldTechContext, isFieldTechUser } from "@/lib/field-tech-auth"
import { TechPageHeader } from "@/components/tech/tech-page-header"
import { TechPerformance } from "@/components/tech/tech-performance"

export const dynamic = "force-dynamic"

export default async function TechPerformancePage() {
  const user = await getSessionUser()
  if (!user) redirect("/tech/login?next=/tech/dashboard/performance")
  if (!isFieldTechUser(user)) redirect("/tech/login")

  const ctx = await getFieldTechContext(user.id)
  if (!ctx) redirect("/tech/dashboard")

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">
      <TechPageHeader businessName={ctx.business_name} title="Performance" backHref="/tech/dashboard" />
      <main className="flex-1 px-4 py-6">
        <TechPerformance />
      </main>
    </div>
  )
}
