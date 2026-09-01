// Gate the field-tech console: must be signed in AND have the field_tech role. Owners/receptionists
// are bounced to their own home so a shared device never lands on the wrong console.

import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/server-session-user"
import { getFieldTechContext, isFieldTechUser } from "@/lib/field-tech-auth"
import { DEFAULT_FIELD_TECH_CAPABILITIES } from "@/lib/field-technician-capabilities"
import { TechPortalChrome } from "@/components/tech/tech-portal-chrome"

export const dynamic = "force-dynamic"

export default async function TechDashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect("/tech/login?next=/tech/dashboard")
  if (user.account_role === "owner") redirect("/dashboard")
  if (user.account_role === "receptionist") redirect("/receptionist")
  if (!isFieldTechUser(user)) redirect("/tech/login")

  // Not-yet-linked techs (see page.tsx's own check) still need chrome around them, so this
  // falls back to nothing-granted rather than blocking the page itself.
  const ctx = await getFieldTechContext(user.id)
  const capabilities = ctx?.technician.capabilities ?? DEFAULT_FIELD_TECH_CAPABILITIES

  return <TechPortalChrome capabilities={capabilities}>{children}</TechPortalChrome>
}
