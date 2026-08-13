"use client"

// Attach a hashed user id to Sentry in production only (never full email or SMS).

import { useEffect } from "react"
import { hashSentryEmail, shouldEnableSentry } from "@/lib/sentry-config"

/** Runs once after login so crashes can be grouped by user without storing PII. */
export function SentryUserContext() {
  useEffect(() => {
    // Skip local dev and missing DSN.
    if (!shouldEnableSentry()) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/auth/session", { credentials: "include" })
        if (!res.ok || cancelled) return
        const json = (await res.json().catch(() => ({}))) as {
          data?: { user?: { id?: string; email?: string } }
        }
        const user = json.data?.user
        if (!user?.id || cancelled) return
        const Sentry = await import("@sentry/nextjs")
        Sentry.setUser({
          id: user.id,
          // Hash only — never send the real inbox address.
          email: user.email ? hashSentryEmail(user.email) : undefined,
        })
      } catch {
        // Session fetch failures should not break the app.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return null
}
