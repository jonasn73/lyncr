// Server-side owner notification filtering for platform admins (master_toggle_mode).

import { getUser } from "@/lib/db"
import type { MasterToggleDelivery, MasterToggleMode, User } from "@/lib/types"
import type { OwnerChannelEvent } from "@/lib/realtime/pusher-server"

const DEFAULT_MODE: MasterToggleMode = "admin"

/** Payload flag consumed by dashboard realtime subscribers. */
export function withMasterToggleMeta(
  payload: Record<string, unknown>,
  delivery: MasterToggleDelivery,
  mode: MasterToggleMode
): Record<string, unknown> {
  return {
    ...payload,
    masterToggleDelivery: delivery,
    masterToggleMode: mode,
  }
}

/** True when the event represents a severe routing / porting failure worth breaking passive silence. */
export function isSevereOwnerRoutingException(
  event: OwnerChannelEvent,
  payload: Record<string, unknown>
): boolean {
  if (payload.severe === true) return true
  if (event === "porting-update") {
    const status = String(payload.status ?? payload.telnyx_status ?? "").toLowerCase()
    if (status === "rejected" || status === "action_required") return true
  }
  return false
}

/** Tech mode: noisy only for events tied to this user's own field-tech assignments or GPS. */
function isLocalTechOwnerEvent(
  ownerId: string,
  event: OwnerChannelEvent,
  payload: Record<string, unknown>
): boolean {
  const techUserId = String(payload.tech_user_id ?? payload.techUserId ?? "")
  if (techUserId && techUserId === ownerId) return true

  const assignedTechId = String(
    payload.assigned_tech_id ?? payload.assignedTechId ?? payload.techUserId ?? ""
  )
  if (assignedTechId && assignedTechId === ownerId) return true

  if (
    (event === "job-assigned" ||
      event === "job-status-updated" ||
      event === "job-booked" ||
      event === "tech-location-updated") &&
    payload.for_owner_tech === true
  ) {
    return true
  }

  return false
}

export type PreparedOwnerEvent =
  | { publish: true; payload: Record<string, unknown> }
  | { publish: false }

/**
 * Apply master-toggle rules for platform admins. Non-admins always get noisy delivery unchanged.
 */
export async function prepareOwnerEventForDelivery(
  ownerId: string,
  event: OwnerChannelEvent,
  payload: Record<string, unknown>,
  userHint?: User | null
): Promise<PreparedOwnerEvent> {
  const user = userHint ?? (await getUser(ownerId))
  if (!user?.is_platform_admin) {
    return { publish: true, payload }
  }

  const mode: MasterToggleMode = user.master_toggle_mode ?? DEFAULT_MODE

  switch (mode) {
    case "admin":
      return {
        publish: true,
        payload: withMasterToggleMeta(payload, "silent", mode),
      }
    case "passive":
      if (isSevereOwnerRoutingException(event, payload)) {
        return {
          publish: true,
          payload: withMasterToggleMeta(payload, "severe", mode),
        }
      }
      console.info("[master-toggle:passive] dropped owner event", { ownerId, event })
      return { publish: false }
    case "tech":
      if (isLocalTechOwnerEvent(ownerId, event, payload)) {
        return {
          publish: true,
          payload: withMasterToggleMeta(payload, "noisy", mode),
        }
      }
      console.info("[master-toggle:tech] silenced non-local owner event", { ownerId, event })
      return {
        publish: true,
        payload: withMasterToggleMeta(payload, "silent", mode),
      }
    default:
      return { publish: true, payload }
  }
}

/** Gate outbound lead SMS for platform admins based on master toggle mode. */
export function shouldSendLeadSmsForPlatformAdmin(user: User): boolean {
  if (!user.is_platform_admin) return true
  const mode = user.master_toggle_mode ?? DEFAULT_MODE
  return mode === "tech"
}
