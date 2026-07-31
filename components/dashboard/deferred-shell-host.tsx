"use client"

// Mount non-critical shell hosts after first paint so refresh/tab work is not blocked.

import { useEffect, useState, type ReactNode } from "react"

type DeferredShellHostProps = {
  children: ReactNode
  /** Delay before mounting when requestIdleCallback is unavailable. */
  fallbackMs?: number
  /** Cap how long we wait for idle before forcing mount. */
  timeoutMs?: number
}

/**
 * Defers children until the browser is idle (or a short timeout).
 * Use for heartbeat / photo toast — not for CallAnsweredModal / LyncEngine.
 */
export function DeferredShellHost({
  children,
  fallbackMs = 2_500,
  timeoutMs = 4_000,
}: DeferredShellHostProps) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let idleId: number | undefined
    let timerId: ReturnType<typeof setTimeout> | undefined

    const mount = () => {
      if (!cancelled) setReady(true)
    }

    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
        cancelIdleCallback?: (id: number) => void
      }
    ).requestIdleCallback

    if (typeof ric === "function") {
      idleId = ric(mount, { timeout: timeoutMs })
    } else {
      timerId = setTimeout(mount, fallbackMs)
    }

    return () => {
      cancelled = true
      const cic = (
        window as Window & { cancelIdleCallback?: (id: number) => void }
      ).cancelIdleCallback
      if (idleId != null && typeof cic === "function") cic(idleId)
      if (timerId != null) clearTimeout(timerId)
    }
  }, [fallbackMs, timeoutMs])

  if (!ready) return null
  return <>{children}</>
}
