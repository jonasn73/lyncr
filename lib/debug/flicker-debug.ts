/**
 * Temporary flicker diagnosis — console-only, no network, no PII.
 * On when NODE_ENV !== "production" OR URL has ?debugFlicker=1.
 * Production default: OFF (cheap boolean checks only).
 */

"use client"

import {
  useEffect,
  useRef,
  type ReactNode,
  createElement,
} from "react"

export const LYNCR_FLICKER_PREFIX = "[LYNCR_FLICKER]"

type SafeScalar = string | number | boolean | null | undefined

export type FlickerPayload = {
  event: string
  component: string
  instanceId?: string
  renderCount?: number
} & Record<string, SafeScalar | SafeScalar[] | undefined>

let instanceSeq = 0

/** True in non-production builds, or in the browser when ?debugFlicker=1. */
export function isFlickerDebugEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true
  if (typeof window === "undefined") return false
  try {
    return new URLSearchParams(window.location.search).get("debugFlicker") === "1"
  } catch {
    return false
  }
}

function canEmit(): boolean {
  return typeof window !== "undefined" && isFlickerDebugEnabled()
}

function allocInstanceId(component: string): string {
  instanceSeq += 1
  return `${component}#${instanceSeq}`
}

/** Pathname only — strips query/hash so values never hit the console. */
export function flickerPathnameOnly(href: string): string {
  const raw = String(href || "")
  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return new URL(raw).pathname || "/"
    }
  } catch {
    /* fall through */
  }
  const noHash = raw.split("#")[0] ?? raw
  const path = noHash.split("?")[0] ?? noHash
  return path || "/"
}

/** Search param *names* only (never values). */
export function flickerSafeSearchParamNames(search: string): string[] {
  try {
    const q = search.startsWith("?") ? search.slice(1) : search
    return Array.from(new URLSearchParams(q).keys())
  } catch {
    return []
  }
}

function stableSerialize(tracked: Record<string, SafeScalar | SafeScalar[]>): string {
  const keys = Object.keys(tracked).sort()
  const out: Record<string, SafeScalar | SafeScalar[]> = {}
  for (const k of keys) {
    const v = tracked[k]
    if (v !== undefined) out[k] = v
  }
  return JSON.stringify(out)
}

/** Structured console line — prefix is exact for DevTools filter. */
export function logFlicker(payload: FlickerPayload): void {
  if (!canEmit()) return
  const t =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? Math.round(performance.now() * 100) / 100
      : 0
  // Single object keeps the line searchable and avoids dumping nested secrets.
  console.log(LYNCR_FLICKER_PREFIX, { t, ...payload })
}

export function logFlickerNav(
  type: "push" | "replace" | "refresh" | "location",
  destinationHref: string,
  component?: string
): void {
  logFlicker({
    event: "nav",
    component: component ?? "navigation",
    navType: type,
    pathname: flickerPathnameOnly(destinationHref),
  })
}

/**
 * Mount / unmount + tracked state transitions (not every render).
 * Instance id is allocated once via useRef (counter, not Math.random).
 */
export function useFlickerDebugLifecycle(
  component: string,
  tracked?: Record<string, SafeScalar | SafeScalar[]>
): {
  instanceId: string
  log: (event: string, extra?: Record<string, SafeScalar | SafeScalar[]>) => void
} {
  const enabled = isFlickerDebugEnabled()
  const idRef = useRef("")
  const rendersRef = useRef(0)
  const prevTrackedRef = useRef("")

  if (enabled && !idRef.current) {
    idRef.current = allocInstanceId(component)
  }

  if (enabled) {
    rendersRef.current += 1
  }

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return
    logFlicker({
      event: "mount",
      component,
      instanceId: idRef.current,
      renderCount: rendersRef.current,
    })
    return () => {
      logFlicker({
        event: "unmount",
        component,
        instanceId: idRef.current,
        renderCount: rendersRef.current,
      })
    }
  }, [enabled, component])

  useEffect(() => {
    if (!enabled || !tracked || typeof window === "undefined") return
    const next = stableSerialize(tracked)
    if (next === prevTrackedRef.current) return
    const first = prevTrackedRef.current.length === 0
    prevTrackedRef.current = next
    logFlicker({
      event: first ? "state" : "transition",
      component,
      instanceId: idRef.current,
      renderCount: rendersRef.current,
      ...tracked,
    })
  })

  const logRef = useRef<(event: string, extra?: Record<string, SafeScalar | SafeScalar[]>) => void>(
    () => undefined
  )
  logRef.current = (event, extra) => {
    if (!enabled || typeof window === "undefined") return
    logFlicker({
      event,
      component,
      instanceId: idRef.current,
      renderCount: rendersRef.current,
      ...extra,
    })
  }

  const log = useRef((event: string, extra?: Record<string, SafeScalar | SafeScalar[]>) => {
    logRef.current(event, extra)
  }).current

  return {
    instanceId: idRef.current,
    log,
  }
}

/** Logs when a Suspense fallback is mounted (chunk still loading). */
function FlickerSuspenseFallbackInner({
  name,
  children,
}: {
  name: string
  children: ReactNode
}) {
  useFlickerDebugLifecycle(`SuspenseFallback:${name}`, { showingFallback: true })
  return children
}

/** Always wraps children in a probe fiber (no visual change; logs only when enabled). */
export function FlickerSuspenseFallback({
  name,
  children,
}: {
  name: string
  children: ReactNode
}): ReactNode {
  return createElement(FlickerSuspenseFallbackInner, { name, children })
}
