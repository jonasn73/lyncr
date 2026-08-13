import { SettingsWorkspaceView } from "@/components/workspace-views/settings-workspace-view"

export const dynamic = "force-dynamic"

/** Statically import Settings so a hard refresh SSR’s the menu list, not SettingsPaneFallback. */
export default function SettingsRoute() {
  // Session snapshot from the layout already fills name/email on first paint.
  return <SettingsWorkspaceView />
}
