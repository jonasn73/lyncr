/**
 * Real workspace org id for cache keys and API — never paint-seed / legacy stubs.
 */

import {
  isWorkspaceOrgStubId,
  readActiveOrganizationId,
} from "@/lib/workspace-organizations"

export function normalizeWorkspaceOrgId(
  raw: string | null | undefined
): string | null {
  if (!raw?.trim() || raw.startsWith("legacy-") || isWorkspaceOrgStubId(raw)) {
    return null
  }
  return raw.trim()
}

/**
 * Org id for session/bootstrap cache reads while context still holds a paint stub.
 * Cookie/localStorage often already has the real uuid before React context upgrades.
 */
export function resolveWorkspaceCacheOrgId(
  normalizedOrgId: string | null
): string | null {
  if (normalizedOrgId) return normalizedOrgId
  const stored = readActiveOrganizationId()
  if (!stored?.trim() || stored.startsWith("legacy-") || isWorkspaceOrgStubId(stored)) {
    return null
  }
  return stored.trim()
}

/** True while the header chip still has a stub id before Neon uuid resolves. */
export function isWorkspaceOrgResolving(
  activeOrganizationId: string | null | undefined,
  orgId: string | null
): boolean {
  return Boolean(activeOrganizationId?.trim()) && orgId == null
}
