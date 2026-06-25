import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/server-session-user"
import { isLyncrAdminUser, LYNCR_ADMIN_EMAIL } from "@/lib/lyncr-admin"
import { AdminChrome } from "@/components/admin-chrome"
import { AdminAccessGuard } from "@/components/admin-access-guard"

export const dynamic = "force-dynamic"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect("/login?next=/admin")
  if (!isLyncrAdminUser(user)) {
    console.warn(
      `[lyncr-admin] UNAUTHORIZED — server layout blocked "${user.email}" (requires ${LYNCR_ADMIN_EMAIL}); redirecting to /dashboard`
    )
    redirect("/dashboard")
  }
  const displayName = user.name?.trim() || user.email
  return (
    <AdminChrome userName={displayName} userEmail={user.email}>
      <AdminAccessGuard>{children}</AdminAccessGuard>
    </AdminChrome>
  )
}
