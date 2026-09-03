// Field tech home — resolves the signed-in tech's context, then renders the launcher hub.

import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/server-session-user"
import { getFieldTechContext, isFieldTechUser } from "@/lib/field-tech-auth"
import { TechHub } from "@/components/tech/tech-hub"

export const dynamic = "force-dynamic"

export default async function TechDashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect("/tech/login?next=/tech/dashboard")
  if (!isFieldTechUser(user)) redirect("/tech/login")

  const ctx = await getFieldTechContext(user.id)

  // Logged in as a tech but not linked to an owner roster yet.
  if (!ctx) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
        <div className="max-w-sm rounded-2xl border border-warning/30 bg-warning/10 p-6">
          <h1 className="text-lg font-semibold text-warning">Account not linked yet</h1>
          <p className="mt-2 text-sm text-warning/80">
            Your Lyncr login is ready, but your dispatcher hasn&apos;t connected you to a team yet.
            Ask them to finish adding you as a field technician.
          </p>
        </div>
      </main>
    )
  }

  return (
    <TechHub
      techUserId={user.id}
      techName={ctx.technician.name || user.name || "Technician"}
      businessName={ctx.business_name}
      capabilities={ctx.technician.capabilities}
    />
  )
}
