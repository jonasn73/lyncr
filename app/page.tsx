import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { verifySessionCookie } from "@/lib/auth"
import { HomeClient } from "@/components/home-client"

// Must read cookies per request — no static shell for `/`.
export const dynamic = "force-dynamic"

/**
 * Valid session → immediate server redirect to `/dashboard` (no client spinner on `/`).
 * Invalid / missing → render login shell without waiting on `fetch("/api/auth/session")`.
 */
export default async function Home() {
  const cookieStore = await cookies()
  const raw = cookieStore.get("zing_session")?.value
  if (verifySessionCookie(raw)) {
    redirect("/dashboard")
  }
  return <HomeClient />
}
