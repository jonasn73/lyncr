import { DashboardTabView } from "@/components/dashboard-tab-views"

/** Settings UI lives in {@link SettingsWorkspaceView} — menu rows open modals via {@link DashboardSettingsModalsHost}. */
export default function SettingsRoute() {
  return <DashboardTabView tab="settings" />
}
