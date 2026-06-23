import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/server-session-user"
import type { User } from "@/lib/types"

/** Resolve the signed-in owner or redirect to login (for async server components). */
export async function requireSessionUser(): Promise<User> {
  const user = await getSessionUser()
  if (!user) redirect("/login?next=/dashboard")
  return user
}
