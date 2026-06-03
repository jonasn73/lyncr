// Field technician portal — resolve a logged-in user → their technician row + owner business context.

import { getFieldTechnicianByPortalUserId, getUser } from "@/lib/db"
import type { FieldTechnician, User } from "@/lib/types"

export type FieldTechContext = {
  tech_user: User
  technician: FieldTechnician
  owner_user_id: string
  business_name: string
}

/** True when the user row is tagged as a field technician login. */
export function isFieldTechUser(user: Pick<User, "account_role">): boolean {
  return user.account_role === "field_tech"
}

/** Load the field tech console context for the signed-in user, or null if not linked. */
export async function getFieldTechContext(portalUserId: string): Promise<FieldTechContext | null> {
  const tech_user = await getUser(portalUserId)
  if (!tech_user) return null

  const technician = await getFieldTechnicianByPortalUserId(portalUserId)
  if (!technician) return null

  const owner = await getUser(technician.owner_user_id)
  const business_name = owner?.business_name?.trim() || "Lyncr"

  return { tech_user, technician, owner_user_id: technician.owner_user_id, business_name }
}
