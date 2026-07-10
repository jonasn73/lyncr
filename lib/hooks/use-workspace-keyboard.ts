import { useEffect, useRef } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"

/**
 * Dismiss the top overlay when Escape is pressed.
 * `onDismiss` should be stable (useCallback) to avoid re-subscribing.
 */
export function useEscapeDismiss(enabled: boolean, onDismiss: () => void): void {
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (event.defaultPrevented) return
      onDismissRef.current()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled])
}

/**
 * Activate a tappable option row when Enter or Space is pressed.
 * Use on service cards, vehicle chips, and key layout buttons.
 */
export function onOptionRowKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  action: () => void,
  options?: { when?: () => boolean }
): void {
  if (event.key !== "Enter" && event.key !== " ") return
  if (event.nativeEvent.isComposing) return
  event.preventDefault()
  event.stopPropagation()
  if ((options?.when ?? (() => true))()) action()
}
