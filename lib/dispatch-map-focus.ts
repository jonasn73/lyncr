// Cross-component bus: intake → Map tab destination pin.

export const LYNCR_FOCUS_DISPATCH_MAP_EVENT = "lyncr-focus-dispatch-map"

export type FocusDispatchMapDetail = {
  lat: number
  lng: number
  label?: string
  address?: string
}

/** Held until the Map tab mounts (deferUntilVisit can miss the custom event). */
let pendingFocus: FocusDispatchMapDetail | null = null

export function emitFocusDispatchMap(detail: FocusDispatchMapDetail): void {
  pendingFocus = detail
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(LYNCR_FOCUS_DISPATCH_MAP_EVENT, { detail }))
}

/** Read + clear a destination queued before the map listener was ready. */
export function consumePendingFocusDispatchMap(): FocusDispatchMapDetail | null {
  const next = pendingFocus
  pendingFocus = null
  return next
}
