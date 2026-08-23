"use client"

// Pause / slow background polls when a presence pane or the browser tab is hidden.

import { useEffect, useState } from "react"

/**
 * True while the browser tab is in the foreground (visibilityState === "visible").
 *
 * Starts `true` unconditionally (matching what SSR assumes, since `document` doesn't
 * exist on the server) and only reads the real value in an effect. Reading
 * `document.visibilityState` in the initializer would make the client's first render
 * diverge from the server's whenever the tab isn't focused the instant the page loads
 * — a real hydration mismatch that makes React discard and rebuild the subtree.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(document.visibilityState === "visible")
    const onVis = () => setVisible(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [])

  return visible
}

/**
 * Poll budgeting for presence-host panes.
 * Returns false when the pane is inactive OR the browser tab is backgrounded —
 * callers should skip setInterval / SWR refresh while this is false.
 * Do not use this to gate Lines Pusher / active-call intake (those stay live).
 */
export function usePollBudget(paneActive = true): boolean {
  const documentVisible = useDocumentVisible()
  return paneActive && documentVisible
}
