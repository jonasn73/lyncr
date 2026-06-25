// Client helpers for master-toggle Pusher payloads (platform admin only).

import type { MasterToggleDelivery, MasterToggleMode } from "@/lib/types"

export function readMasterToggleDelivery(payload: unknown): MasterToggleDelivery | null {
  if (!payload || typeof payload !== "object") return null
  const v = (payload as Record<string, unknown>).masterToggleDelivery
  if (v === "noisy" || v === "silent" || v === "severe") return v
  return null
}

/** True when UI may play sounds, haptics, or blocking popups for this realtime payload. */
export function isNoisyOwnerRealtimePayload(payload: unknown): boolean {
  const delivery = readMasterToggleDelivery(payload)
  if (!delivery) return true
  return delivery === "noisy" || delivery === "severe"
}

/** Session slice used to decide whether booking/call toasts may buzz the owner. */
export type PlatformAdminToggleSession = {
  is_platform_admin?: boolean
  master_toggle_mode?: MasterToggleMode
}

/** Non-admins always get noisy alerts; admins only in tech mode. */
export function shouldPlayOwnerNoisyAlert(session: PlatformAdminToggleSession | null | undefined): boolean {
  if (!session?.is_platform_admin) return true
  return session.master_toggle_mode === "tech"
}
