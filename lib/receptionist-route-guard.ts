// Server guard for a capability-gated page in the receptionist console.
//
// The nav already hides a tab the owner has not opened, but hiding is courtesy: typing the
// URL has to fail too. This is the page-level twin of lib/workspace-actor.ts — same
// capability object, checked before anything renders, so a mirrored surface cannot be
// reached by hand.

import { redirect } from "next/navigation"
import { getReceptionistPortalContext } from "@/lib/receptionist-portal-auth"
import { getSessionUser } from "@/lib/server-session-user"
import type { ReceptionistCapabilities } from "@/lib/types"

/**
 * Redirect away unless the signed-in receptionist has `capability` turned on.
 * Returns her portal context so the page can use it without a second lookup.
 */
export async function requireReceptionistCapability(
  capability: keyof ReceptionistCapabilities,
  currentPath: string
) {
  const user = await getSessionUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(currentPath)}`)

  const ctx = await getReceptionistPortalContext(user.id)
  if (!ctx || ctx.receptionist.capabilities[capability] !== true) redirect("/receptionist")

  return ctx
}
