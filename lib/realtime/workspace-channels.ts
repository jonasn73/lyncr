// Client helper — subscribe to both legacy owner-* and account-wide presence channels.

import { workspacePresenceChannel } from "@/lib/active-operator"

/** Channels a dashboard session should listen on for live intake / call HUD. */
export function workspaceRealtimeChannels(accountId: string): string[] {
  const id = accountId.trim()
  if (!id) return []
  return [`owner-${id}`, workspacePresenceChannel(id)]
}
