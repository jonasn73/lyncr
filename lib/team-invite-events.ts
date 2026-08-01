// Global event so routing drawers + Team tab share one invite modal host.

export { OPEN_TEAM_INVITE_MODAL_EVENT } from "@/lib/settings-modals-events"

import { OPEN_TEAM_INVITE_MODAL_EVENT } from "@/lib/settings-modals-events"

export function openTeamInviteModal() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(OPEN_TEAM_INVITE_MODAL_EVENT))
}

/** Fired after a phone contact or invite is saved so Team roster reloads. */
export const TEAM_ROSTER_CHANGED_EVENT = "lyncr-team-roster-changed"

export type TeamRosterChangeDetail = {
  /** Why the roster changed — used so “set Who answers” tip only shows after adds. */
  action?: "added" | "removed" | "updated"
}

export function notifyTeamRosterChanged(detail?: TeamRosterChangeDetail) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(TEAM_ROSTER_CHANGED_EVENT, { detail: detail ?? {} }))
}
