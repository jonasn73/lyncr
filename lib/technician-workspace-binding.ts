// Resolve which business owner a technician roster row should bind to.

import { getOrganizationById, getOrganizationForOwner, getUser } from "@/lib/db"
import type { User } from "@/lib/types"

/** Thrown when the requested workspace id cannot be mapped to a business owner. */
export class TechnicianWorkspaceError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "TechnicianWorkspaceError"
    this.status = status
  }
}

export type ResolveTechnicianWorkspaceInput = {
  /** Signed-in session user (impersonated owner when an admin is viewing as them). */
  sessionUserId: string
  /** Optional workspace id from JSON body (`workspaceId`, `businessId`, `organization_id`). */
  workspaceId?: string | null
  businessId?: string | null
  organizationId?: string | null
  organization_id?: string | null
  /** Optional workspace id from an impersonation / workspace header. */
  headerWorkspaceId?: string | null
}

export type ResolvedTechnicianWorkspace = {
  /** Business owner users.id — stored on field_technicians.user_id. */
  ownerUserId: string
  /** Organization workspace id when one was supplied or resolved. */
  workspaceId: string | null
  owner: User
}

/**
 * Map the active viewed workspace to the business owner that should own the new technician row.
 * Defaults to the session user (correct when a platform admin is impersonating a business owner).
 */
export async function resolveTechnicianTargetWorkspace(
  input: ResolveTechnicianWorkspaceInput
): Promise<ResolvedTechnicianWorkspace> {
  const rawWorkspaceId =
    input.workspaceId?.trim() ||
    input.businessId?.trim() ||
    input.organizationId?.trim() ||
    input.organization_id?.trim() ||
    input.headerWorkspaceId?.trim() ||
    null

  let ownerUserId = input.sessionUserId
  let workspaceId: string | null = null

  if (rawWorkspaceId) {
    if (rawWorkspaceId.startsWith("legacy-")) {
      ownerUserId = rawWorkspaceId.slice("legacy-".length)
      workspaceId = rawWorkspaceId
    } else {
      const orgForSession = await getOrganizationForOwner(rawWorkspaceId, input.sessionUserId)
      if (orgForSession) {
        ownerUserId = orgForSession.owner_user_id
        workspaceId = orgForSession.id
      } else {
        const orgById = await getOrganizationById(rawWorkspaceId)
        if (orgById) {
          ownerUserId = orgById.owner_user_id
          workspaceId = orgById.id
        } else {
          const ownerCandidate = await getUser(rawWorkspaceId)
          if (ownerCandidate?.account_role === "owner") {
            ownerUserId = ownerCandidate.id
            workspaceId = null
          } else {
            throw new TechnicianWorkspaceError("Unknown workspace or business id", 400)
          }
        }
      }
    }
  }

  const owner = await getUser(ownerUserId)
  if (!owner || owner.account_role !== "owner") {
    throw new TechnicianWorkspaceError("Target business workspace not found", 404)
  }

  return { ownerUserId, workspaceId, owner }
}
