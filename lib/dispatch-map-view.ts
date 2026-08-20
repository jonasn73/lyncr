// Shared camera state so Map tab and Activities embed stay on the same view.

export type DispatchMapView = {
  center: [number, number]
  zoom: number
}

const SESSION_KEY = "lyncr_dispatch_map_view"

let sharedView: DispatchMapView | null = null

function readSessionView(): DispatchMapView | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DispatchMapView
    if (
      !parsed ||
      !Array.isArray(parsed.center) ||
      parsed.center.length !== 2 ||
      !Number.isFinite(parsed.center[0]) ||
      !Number.isFinite(parsed.center[1]) ||
      !Number.isFinite(parsed.zoom)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeSessionView(view: DispatchMapView): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(view))
  } catch {
    /* quota / private mode */
  }
}

/** Last map center/zoom written by either DispatchLiveMap instance. */
export function getSharedDispatchMapView(): DispatchMapView | null {
  if (sharedView) return sharedView
  sharedView = readSessionView()
  return sharedView
}

/** Persist camera after pan/zoom so the other tab (and refresh) opens on the same frame. */
export function setSharedDispatchMapView(center: [number, number], zoom: number): void {
  if (!Number.isFinite(center[0]) || !Number.isFinite(center[1]) || !Number.isFinite(zoom)) return
  sharedView = { center: [center[0], center[1]], zoom }
  writeSessionView(sharedView)
}

/** Drop a stale over-zoomed camera (e.g. leftover street-level view from an older build). */
export function clearSharedDispatchMapView(): void {
  sharedView = null
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}
