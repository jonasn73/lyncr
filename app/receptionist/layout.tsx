import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { ReceptionistPortalChrome } from "@/components/receptionist-portal-chrome"
import { ReceptionistWorkspaceProviders } from "@/components/receptionist-workspace-providers"
import { getReceptionistPortalContext, isReceptionistPortalUser } from "@/lib/receptionist-portal-auth"
import { getSessionUser } from "@/lib/server-session-user"
import { isLyncrAdminUser } from "@/lib/lyncr-admin"
import { listOrganizationsForOwner } from "@/lib/db"
import {
  VIEWPORT_COOKIE,
  VIEWPORT_MOBILE_HEADER,
  parseViewportIsMobile,
} from "@/lib/viewport-hint"
import type { Organization } from "@/lib/types"

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

  // The shared CRM / Scheduler views scope everything by workspace, and the receptionist
  // cannot read GET /api/organizations (owner-only), so resolve the owner's here.
  let organizations: Organization[] = []
  try {
    organizations = await listOrganizationsForOwner(ctx.owner_user_id)
  } catch (e) {
    console.error("[receptionist/layout] organizations", e)
  }
  const defaultOrg = organizations.find((o) => o.is_default) ?? organizations[0] ?? null

  const [h, cookieStore] = await Promise.all([headers(), cookies()])
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

  const portalName = ctx.receptionist.name?.trim() || displayName
  return (
    <ReceptionistWorkspaceProviders
      viewer={{ actorRole: "receptionist", capabilities: ctx.receptionist.capabilities }}
      receptionistName={portalName}
      receptionistEmail={user.email}
      ownerUserId={ctx.owner_user_id}
      organizations={organizations}
      activeOrganizationId={defaultOrg?.id ?? null}
      initialIsMobile={initialIsMobile}
    >
      <ReceptionistPortalChrome
        userName={portalName}
        businessName={ctx.business_name}
        capabilities={ctx.receptionist.capabilities}
      >
        {children}
      </ReceptionistPortalChrome>
    </ReceptionistWorkspaceProviders>
  )
}
