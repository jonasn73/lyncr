// Cross-component bus: intake → Map tab destination pin, and Map → back to intake.

export const LYNCR_FOCUS_DISPATCH_MAP_EVENT = "lyncr-focus-dispatch-map"
export const LYNCR_RETURN_TO_INTAKE_EVENT = "lyncr-return-to-intake"
export const LYNCR_CLEAR_DISPATCH_MAP_DESTINATION_EVENT = "lyncr-clear-dispatch-map-destination"

export type FocusDispatchMapDetail = {
  lat: number
  lng: number
  label?: string
  address?: string
}

/**
 * Sticky destination for the Map tab — survives remounts / dynamic import.
 * Cleared only when the operator taps Clear pin (or explicitly clears).
 */
let activeDestination: FocusDispatchMapDetail | null = null

/** Held if CallAnsweredModal missed the click (remount / not listening yet). */
let pendingReturnToIntake = false

export function emitFocusDispatchMap(detail: FocusDispatchMapDetail): void {
  activeDestination = detail
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(LYNCR_FOCUS_DISPATCH_MAP_EVENT, { detail }))
}

/** Current intake destination (does not clear). */
export function getActiveDispatchMapDestination(): FocusDispatchMapDetail | null {
  return activeDestination
}

/** Clear destination pin + notify map listeners. */
export function clearActiveDispatchMapDestination(): void {
  activeDestination = null
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(LYNCR_CLEAR_DISPATCH_MAP_DESTINATION_EVENT))
}

/** @deprecated Prefer getActiveDispatchMapDestination — kept for older call sites. */
export function consumePendingFocusDispatchMap(): FocusDispatchMapDetail | null {
  return activeDestination
}

/** Map overlay "Return to Intake Form" — re-opens the intake sheet for the operator. */
export function emitReturnToIntakeFromMap(): void {
  // Latch so a late-mounting modal can still expand after the click.
  pendingReturnToIntake = true
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(LYNCR_RETURN_TO_INTAKE_EVENT))
}

/** Read + clear a return request queued before the intake listener was ready. */
export function consumePendingReturnToIntake(): boolean {
  const next = pendingReturnToIntake
  pendingReturnToIntake = false
  return next
}
