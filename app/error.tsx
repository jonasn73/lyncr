"use client"

import { useEffect } from "react"

// Next.js segment error boundary: shows when an error occurs in this segment or a child
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Always log the full error so we can diagnose production crashes (e.g. React #185).
  useEffect(() => {
    console.error("[lyncr] app/error.tsx", error.message, error.digest, error.stack)
  }, [error])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6">
      <p className="text-center text-foreground">Something went wrong.</p>
      {error.message ? (
        <p className="max-w-md text-center text-xs text-muted-foreground">{error.message}</p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Go to login
        </a>
      </div>
    </div>
  )
}
