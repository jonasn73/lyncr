import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import Link from "next/link"
import { verifySessionCookie, getSessionCookieName } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isPlatformAdminUser } from "@/lib/platform-admin"
import type { User } from "@/lib/types"

export const dynamic = "force-dynamic"

async function userForAdminGate(): Promise<User | null> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(getSessionCookieName())?.value
  const userId = verifySessionCookie(raw)
  if (!userId) return null
  if (process.env.NODE_ENV === "development" && userId === "dev-user") {
    const devEmail = process.env.DEV_LOGIN_EMAIL?.trim().toLowerCase() ?? "dev@zing.local"
    return {
      id: "dev-user",
      email: devEmail,
      name: "Dev User",
      phone: "+15551234567",
      business_name: "My Business",
      inbound_receptionist_whisper_enabled: true,
      industry: "generic",
      telnyx_ai_assistant_id: null,
      created_at: new Date().toISOString(),
      credit_balance_cents: 0,
      billing_plan: "trial",
      is_platform_admin: false,
    }
  }
  return getUser(userId)
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await userForAdminGate()
  if (!user) redirect("/login?next=/admin")
  if (!isPlatformAdminUser(user)) redirect("/dashboard")
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">Operator console</span>
          <span className="text-xs text-muted-foreground">Signed in as {user.email}</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/dashboard/help" className="text-sm font-medium text-primary hover:underline">
            Help
          </Link>
          <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
            Back to app
          </Link>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}
