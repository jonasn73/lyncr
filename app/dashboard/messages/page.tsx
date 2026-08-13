import { MessagesWorkspaceView } from "@/components/workspace-views/messages-workspace-view"

export const dynamic = "force-dynamic"

/** Statically import Messages so a hard refresh SSR’s inbox chrome, not MessagesPaneFallback. */
export default function MessagesRoute() {
  // Presence host injects isActive so hidden-tab polls stay paused.
  return <MessagesWorkspaceView />
}
