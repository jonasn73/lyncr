"use client"

/**
 * Session-seed helpers — #185-safe.
 *
 * useSessionSeed reads synchronously when revision/session key changes (no
 * useLayoutEffect lag) so paint → session unlock does not flash an extra frame.
 */

import { useMemo } from "react"
import { useSessionCacheReady } from "@/components/session-cache-hydration-gate"

/**
 * @deprecated Prefer useSessionSeed. Kept as a no-op so old call sites compile;
 * it never reads storage (avoids #185).
 */
function useClientSnapshot<T>(
  _getClientSnapshot: () => T,
  getServerSnapshot: () => T,
  _revisionKey: string | number | null | undefined = ""
): T {
  void _getClientSnapshot
  void _revisionKey
  return getServerSnapshot()
}

/**
 * Last-known session value — re-reads synchronously when revisionKey or session
 * unlock changes (same render pass as SessionCacheHydrationGate flip).
 */
export function useSessionSeed<T>(
  read: () => T,
  serverFallback: T,
  revisionKey: string | number | null | undefined = ""
): T {
  const sessionReady = useSessionCacheReady()
  const effectiveKey = `${revisionKey ?? ""}::s${sessionReady ? 1 : 0}`

  return useMemo(() => {
    try {
      return read()
    } catch {
      return serverFallback
    }
    // Intentionally omit `read` — inline closures; effectiveKey gates re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveKey, serverFallback])
}
