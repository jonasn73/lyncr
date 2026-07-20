// Shared camera state so Map tab and Activities embed stay on the same view.

export type DispatchMapView = {
  center: [number, number]
  zoom: number
}

let sharedView: DispatchMapView | null = null

/** Last map center/zoom written by either DispatchLiveMap instance. */
export function getSharedDispatchMapView(): DispatchMapView | null {
  return sharedView
}

/** Persist camera after pan/zoom so the other tab opens on the same frame. */
export function setSharedDispatchMapView(center: [number, number], zoom: number): void {
  if (!Number.isFinite(center[0]) || !Number.isFinite(center[1]) || !Number.isFinite(zoom)) return
  sharedView = { center: [center[0], center[1]], zoom }
}

/** Drop a stale over-zoomed camera (e.g. leftover street-level view from an older build). */
export function clearSharedDispatchMapView(): void {
  sharedView = null
}
