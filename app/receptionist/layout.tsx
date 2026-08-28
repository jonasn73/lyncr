import { redirect } from "next/navigation"
import { ReceptionistPortalChrome } from "@/components/receptionist-portal-chrome"
import { getReceptionistPortalContext, isReceptionistPortalUser } from "@/lib/receptionist-portal-auth"
import { getSessionUser } from "@/lib/server-session-user"
import { isLyncrAdminUser } from "@/lib/lyncr-admin"

export const dynamic = "force-dynamic"

export default async function ReceptionistPortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect("/login?next=/receptionist")
  if (isLyncrAdminUser(user)) redirect("/admin")

  const ctx = await getReceptionistPortalContext(user.id)
  const displayName = user.name?.trim() || user.email

  if (!ctx) {
    if (isReceptionistPortalUser(user)) {
      return (
        <ReceptionistPortalChrome userName={displayName}>
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-6 text-sm text-warning">
            <p className="font-semibold text-warning">Receptionist profile not linked yet</p>
            <p className="mt-2 text-warning/90">
              Your login has the receptionist role, but no team record is connected. Ask the business owner to link
              your account in Neon (<code className="text-xs">receptionists.portal_user_id</code>).
            </p>
          </div>
        </ReceptionistPortalChrome>
      )
    }
    redirect("/dashboard")
  }

  const portalName = ctx.receptionist.name?.trim() || displayName
  return (
    <ReceptionistPortalChrome
      userName={portalName}
      businessName={ctx.business_name}
      dispatching={ctx.receptionist.capabilities.dispatching}
    >
      {children}
    </ReceptionistPortalChrome>
  )
}
