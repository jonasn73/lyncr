// Gate the field-tech console: must be signed in AND have the field_tech role. Owners/receptionists
// are bounced to their own home so a shared device never lands on the wrong console.

import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/server-session-user"
import { isFieldTechUser } from "@/lib/field-tech-auth"

export const dynamic = "force-dynamic"

export default async function TechDashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect("/tech/login?next=/tech/dashboard")
  if (user.account_role === "owner") redirect("/dashboard")
  if (user.account_role === "receptionist") redirect("/receptionist")
  if (!isFieldTechUser(user)) redirect("/tech/login")
  return <>{children}</>
}
