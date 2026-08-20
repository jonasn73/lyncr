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

import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"

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
 * PII-free summary of what `setBootstrap(network)` is about to replace.
 * Counts + field-name diffs only (no phones, names, org ids, or payloads).
 */
export function summarizeBootstrapNetworkApply(
  prev: DashboardMainBootstrap | null | undefined,
  next: DashboardMainBootstrap
): Record<string, SafeScalar> {
  const changed: string[] = []
  if (!prev) {
    return {
      prevHadBootstrap: false,
      changedKeys: "organizations,phoneLines,routing",
      prevOrgCount: 0,
      nextOrgCount: next.organizations.length,
      prevPhoneLineCount: 0,
      nextPhoneLineCount: next.phoneLines.length,
      prevReceptionistCount: 0,
      nextReceptionistCount: next.routing.receptionists.length,
      primaryLineChanged: true,
      ownerPhoneChanged: true,
      routingConfigChanged: true,
      layoutDrivingChanged: true,
    }
  }

  if (
    prev.organizations.length !== next.organizations.length ||
    prev.organizations.some(
      (o, i) =>
        o.id !== next.organizations[i]?.id ||
        o.name !== next.organizations[i]?.name ||
        o.is_default !== next.organizations[i]?.is_default
    )
  ) {
    changed.push("organizations")
  }

  if (
    prev.phoneLines.length !== next.phoneLines.length ||
    prev.phoneLines.some(
      (l, i) =>
        l.number !== next.phoneLines[i]?.number ||
        l.status !== next.phoneLines[i]?.status ||
        l.organization_id !== next.phoneLines[i]?.organization_id ||
        (l.label ?? "") !== (next.phoneLines[i]?.label ?? "")
    )
  ) {
    changed.push("phoneLines")
  }

  const primaryLineChanged =
    prev.routing.primaryLineNumber !== next.routing.primaryLineNumber
  const ownerPhoneChanged = prev.routing.ownerPhone !== next.routing.ownerPhone
  if (primaryLineChanged || ownerPhoneChanged) changed.push("routing.identity")

  if (
    prev.routing.receptionists.length !== next.routing.receptionists.length ||
    prev.routing.receptionists.some(
      (r, i) =>
        r.id !== next.routing.receptionists[i]?.id ||
        r.name !== next.routing.receptionists[i]?.name ||
        r.phone !== next.routing.receptionists[i]?.phone ||
        r.is_active !== next.routing.receptionists[i]?.is_active
    )
  ) {
    changed.push("routing.receptionists")
  }

  const ar = prev.routing.routing
  const br = next.routing.routing
  const routingConfigChanged =
    ar.selected_receptionist_id !== br.selected_receptionist_id ||
    ar.fallback_type !== br.fallback_type ||
    ar.ai_ring_owner_first !== br.ai_ring_owner_first ||
    ar.ring_timeout_seconds !== br.ring_timeout_seconds ||
    ar.routing_strategy !== br.routing_strategy ||
    ar.allow_lyncr_network_fallback !== br.allow_lyncr_network_fallback ||
    ar.inbound_caller_greeting_enabled !== br.inbound_caller_greeting_enabled ||
    ar.forward_original_caller_id !== br.forward_original_caller_id
  if (routingConfigChanged) changed.push("routing.config")

  const layoutDrivingChanged =
    changed.includes("organizations") ||
    changed.includes("phoneLines") ||
    changed.includes("routing.identity") ||
    changed.includes("routing.receptionists")

  return {
    prevHadBootstrap: true,
    changedKeys: changed.length > 0 ? changed.join(",") : "(none-detected)",
    prevOrgCount: prev.organizations.length,
    nextOrgCount: next.organizations.length,
    prevPhoneLineCount: prev.phoneLines.length,
    nextPhoneLineCount: next.phoneLines.length,
    prevReceptionistCount: prev.routing.receptionists.length,
    nextReceptionistCount: next.routing.receptionists.length,
    primaryLineChanged,
    ownerPhoneChanged,
    routingConfigChanged,
    layoutDrivingChanged,
  }
}

/** Active dashboard tab from pathname only (no query values). */
export function flickerActiveDashboardPage(): string {
  if (typeof window === "undefined") return ""
  const path = flickerPathnameOnly(window.location.pathname)
  const segment = path.replace(/^\/dashboard\/?/, "").trim()
  return segment || "dashboard"
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
