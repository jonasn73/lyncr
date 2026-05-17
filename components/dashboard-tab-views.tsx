"use client"

/**
 * Legacy route stubs + re-exports. Tab UI is driven by {@link DashboardPresenceHost}
 * in dashboard-main-content (all views stay mounted; CSS toggles visibility).
 */
import type { DashboardPresencePageId } from "@/components/dashboard-presence-host"

export {
  DashboardPresenceHost as DashboardTabHost,
  DASHBOARD_PRESENCE_PAGE_IDS as WORKSPACE_TAB_IDS,
  type DashboardPresencePageId as WorkspaceTabId,
  isDashboardPresencePage as isWorkspaceTab,
} from "@/components/dashboard-presence-host"

export function DashboardTabView(_props: { tab: DashboardPresencePageId }) {
  return null
}
