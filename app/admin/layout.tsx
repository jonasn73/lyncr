import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/server-session-user"
import { isPlatformAdminUser } from "@/lib/platform-admin"
import { AdminChrome } from "@/components/admin-chrome"

export const dynamic = "force-dynamic"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect("/login?next=/admin")
  if (!isPlatformAdminUser(user)) redirect("/dashboard")
  const displayName = user.name?.trim() || user.email
  return (
    <AdminChrome userName={displayName} userEmail={user.email}>
      {children}
    </AdminChrome>
  )
}
