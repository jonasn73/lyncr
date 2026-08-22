"use client"

import { useMemo } from "react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import {
  isWorkspaceOrgResolving,
  normalizeWorkspaceOrgId,
} from "@/lib/workspace-org-id"

/** Normalized org id + resolving flag — use on every tenant-scoped surface. */
export function useWorkspaceOrgId() {
  const { activeOrganizationId } = useDashboardWorkspace()
  const orgId = useMemo(
    () => normalizeWorkspaceOrgId(activeOrganizationId),
    [activeOrganizationId]
  )
  const orgResolving = isWorkspaceOrgResolving(activeOrganizationId, orgId)
  const orgReady = orgId != null || !activeOrganizationId?.trim()
  return { orgId, orgReady, orgResolving, activeOrganizationId }
}
