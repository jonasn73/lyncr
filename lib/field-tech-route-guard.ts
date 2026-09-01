// Server guard for a capability-gated page in the tech console.
//
// The nav already hides a tab the owner has not opened, but hiding is courtesy: typing the
// URL has to fail too. Same shape as lib/receptionist-route-guard.ts's requireReceptionistCapability.

import { redirect } from "next/navigation"
import { getFieldTechContext } from "@/lib/field-tech-auth"
import { getSessionUser } from "@/lib/server-session-user"
import type { FieldTechnicianCapabilities } from "@/lib/types"

/**
 * Redirect away unless the signed-in tech has `capability` turned on.
 * Returns their field-tech context so the page can use it without a second lookup.
 */
export async function requireFieldTechCapability(
  capability: keyof FieldTechnicianCapabilities,
  currentPath: string
) {
  const user = await getSessionUser()
  if (!user) redirect(`/tech/login?next=${encodeURIComponent(currentPath)}`)

  const ctx = await getFieldTechContext(user.id)
  if (!ctx || ctx.technician.capabilities[capability] !== true) redirect("/tech/dashboard")

  return ctx
}
