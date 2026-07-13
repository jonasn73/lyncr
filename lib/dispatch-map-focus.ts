// Cross-component bus: intake → Map tab destination pin, and Map → back to intake.

export const LYNCR_FOCUS_DISPATCH_MAP_EVENT = "lyncr-focus-dispatch-map"
export const LYNCR_RETURN_TO_INTAKE_EVENT = "lyncr-return-to-intake"

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

/** Map overlay "Return to Intake Form" — re-opens the intake sheet for the operator. */
export function emitReturnToIntakeFromMap(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(LYNCR_RETURN_TO_INTAKE_EVENT))
}
