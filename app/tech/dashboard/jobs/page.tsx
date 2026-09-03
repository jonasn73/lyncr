// Tech console — Jobs tab: the technician's live work queue.

import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/server-session-user"
import { getFieldTechContext, isFieldTechUser } from "@/lib/field-tech-auth"
import { TechPageHeader } from "@/components/tech/tech-page-header"
import { TechConsole } from "@/components/tech/tech-console"

export const dynamic = "force-dynamic"

export default async function TechJobsPage() {
  const user = await getSessionUser()
  if (!user) redirect("/tech/login?next=/tech/dashboard/jobs")
  if (!isFieldTechUser(user)) redirect("/tech/login")

  const ctx = await getFieldTechContext(user.id)
  if (!ctx) redirect("/tech/dashboard")

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">
      <TechPageHeader businessName={ctx.business_name} title="Jobs" backHref="/tech/dashboard" />
      <TechConsole techUserId={user.id} capabilities={ctx.technician.capabilities} />
    </div>
  )
}
