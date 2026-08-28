"use client"

import { useEffect, useState } from "react"
import {
  clearClientCrashDump,
  readClientCrashDump,
  writeClientCrashDump,
  type ClientCrashDump,
} from "@/lib/client-crash-dump"

// Next.js segment error boundary — also shows last component stack if we captured one.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [dump, setDump] = useState<ClientCrashDump | null>(null)

  useEffect(() => {
    console.error("[lyncr] app/error.tsx", error.message, error.digest, error.stack)
    if (process.env.NODE_ENV === "production") {
      void import("@sentry/nextjs").then((Sentry) => {
        Sentry.captureException(error)
      })
    }
    const existing = readClientCrashDump()
    // Prefer a dump that already has a component stack from ErrorBoundary.
    if (existing?.componentStack || existing?.stack) {
      setDump(existing)
      return
    }
    writeClientCrashDump({
      at: Date.now(),
      message: error.message || "Unknown error",
      stack: error.stack ?? null,
      componentStack: null,
    })
    setDump(readClientCrashDump())
  }, [error])

  // Component tree first; JS stack second (minified builds often only have the latter).
  const dumpText = dump?.componentStack || dump?.stack || error.stack || null

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6">
      <p className="text-center text-foreground">Something went wrong.</p>
      {error.message ? (
        <p className="max-w-md text-center text-xs text-muted-foreground">{error.message}</p>
      ) : null}
      {dumpText ? (
        <pre className="max-h-48 max-w-lg overflow-auto rounded-lg border border-border bg-card p-3 text-left text-micro leading-snug text-muted-foreground whitespace-pre-wrap">
          {dumpText}
        </pre>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            clearClientCrashDump()
            reset()
          }}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Try again
        </button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full document reload: a client-side Link would keep the crashed React tree and router state alive */}
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
