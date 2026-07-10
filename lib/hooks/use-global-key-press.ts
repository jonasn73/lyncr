"use client"

// Global keyboard shortcut helper — registers a window keydown listener.

import { useEffect } from "react"

export type GlobalKeyPressOptions = {
  /** When true, the handler runs (e.g. only on dashboard routes). */
  enabled?: boolean
  /** Require meta (⌘) or ctrl key. */
  metaOrCtrl?: boolean
  /** Require shift. */
  shift?: boolean
  /** Require alt/option. */
  alt?: boolean
  /** Key name to match (case-insensitive for letters). */
  key: string
  /** Called when the combo matches; return false to skip preventDefault. */
  onPress: (event: KeyboardEvent) => void
}

/** Attach a document-level keydown shortcut with automatic cleanup. */
export function useGlobalKeyPress({
  enabled = true,
  metaOrCtrl = false,
  shift = false,
  alt = false,
  key,
  onPress,
}: GlobalKeyPressOptions): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      const pressed = event.key.toLowerCase() === key.toLowerCase()
      if (!pressed) return
      if (metaOrCtrl && !(event.metaKey || event.ctrlKey)) return
      if (shift && !event.shiftKey) return
      if (alt && !event.altKey) return
      if (!shift && event.shiftKey && metaOrCtrl) return

      onPress(event)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, metaOrCtrl, shift, alt, key, onPress])
}
