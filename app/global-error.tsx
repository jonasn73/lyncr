"use client"

import { useEffect } from "react"

// Root error boundary: replaces entire root layout when an error bubbles up
// Must define its own <html> and <body>
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Last-resort crash: report to Sentry in production only.
    if (process.env.NODE_ENV !== "production") return
    void import("@sentry/nextjs").then((Sentry) => {
      Sentry.captureException(error)
    })
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#1a1a2e", color: "#e4e4e7", minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <p>Something went wrong.</p>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{ padding: "8px 16px", borderRadius: 8, background: "#2dd4bf", color: "#0f172a", border: "none", cursor: "pointer", fontWeight: 500 }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{ padding: "8px 16px", borderRadius: 8, background: "#27272a", color: "#e4e4e7", textDecoration: "none", fontWeight: 500 }}
          >
            Go to login
          </a>
        </div>
      </body>
    </html>
  )
}
