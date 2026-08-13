"use client"

// Isolated useSearchParams reader — never wrap a whole dashboard pane in this Suspense.
// Next.js suspends on useSearchParams during client navigations; that was remounting
// Activity/CRM/Messages and flashing skeletons even when cache already had rows.

import { Suspense, useEffect } from "react"
import { useSearchParams } from "next/navigation"

/** Current `window.location.search` ("" on the server). Safe for ssr:false panes. */
export function readWindowSearchQuery(): string {
  // No window during SSR — empty query, never touch sessionStorage here.
  if (typeof window === "undefined") return ""
  // Same string the App Router would give useSearchParams().toString() with a leading ?.
  return window.location.search
}

/** Turn "?filter=hold" / "filter=hold" into URLSearchParams for .get(). */
export function searchQueryToParams(query: string): URLSearchParams {
  // Strip a leading ? so URLSearchParams does not treat it as part of a key.
  const q = query.startsWith("?") ? query.slice(1) : query
  return new URLSearchParams(q)
}

function ClientSearchParamsReader({
  onQuery,
}: {
  onQuery: (query: string) => void
}) {
  // This hook is the one that suspends — keep it in this tiny child only.
  const searchParams = useSearchParams()

  useEffect(() => {
    // Mirror the live URL into the parent without unmounting the pane.
    const qs = searchParams.toString()
    onQuery(qs ? `?${qs}` : "")
  }, [searchParams, onQuery])

  // Nothing visual — parent already painted from window.location / cache.
  return null
}

/** Subscribe to URL search changes without replacing painted tab content. */
export function ClientSearchParamsBridge({
  onQuery,
}: {
  onQuery: (query: string) => void
}) {
  return (
    // null fallback: a suspend must not swap in ActivityPaneFallback / CRM skeleton.
    <Suspense fallback={null}>
      <ClientSearchParamsReader onQuery={onQuery} />
    </Suspense>
  )
}
