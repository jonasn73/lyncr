import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { verifySessionCookie, getSessionCookieName } from "@/lib/auth"
import { getSessionUser } from "@/lib/server-session-user"
import { isPlatformAdminUser } from "@/lib/platform-admin"
import { HomeClient } from "@/components/home-client"

export const dynamic = "force-dynamic"

/**
 * Valid session → redirect: operators to `/admin`, everyone else to `/dashboard`.
 * No session → marketing / login shell.
 */
export default async function Home() {
  const cookieStore = await cookies()
  const raw = cookieStore.get(getSessionCookieName())?.value
  if (!verifySessionCookie(raw)) {
    return <HomeClient />
  }
  const user = await getSessionUser()
  if (user && isPlatformAdminUser(user)) {
    redirect("/admin")
  }
  redirect("/dashboard")
}
