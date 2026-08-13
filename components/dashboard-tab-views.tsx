"use client"

/**
 * Legacy re-exports. Primary tab UI is {@link DashboardPresenceHost}.
 * Hard-refresh SSR comes from each dashboard route page's static import, passed
 * in as `ssrActiveSlot` — do not render a second copy from DashboardTabView.
 */
import type { DashboardPresencePageId } from "@/components/dashboard-presence-host"

export {
  DashboardPresenceHost as DashboardTabHost,
  DASHBOARD_PRESENCE_PAGE_IDS as WORKSPACE_TAB_IDS,
  type DashboardPresencePageId as WorkspaceTabId,
  isDashboardPresencePage as isWorkspaceTab,
} from "@/components/dashboard-presence-host"

/** @deprecated Route pages now return the real workspace view; this stays null. */
export function DashboardTabView(_props: { tab: DashboardPresencePageId }) {
  return null
}
