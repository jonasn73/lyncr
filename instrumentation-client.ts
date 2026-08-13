// Browser Sentry + Session Replay — Next.js 16 loads this before client code.

import * as Sentry from "@sentry/nextjs"
import { isNoisyHydrationWarning, resolveSentryDsn, shouldEnableSentry } from "@/lib/sentry-config"

// Public DSN only — private SENTRY_DSN is not available in the browser.
const dsn = resolveSentryDsn()

// Replay is production-only so local flashes stay in DevErrorLogDrawer.
if (shouldEnableSentry({ dsn })) {
  Sentry.init({
    dsn,
    // Light tracing so we can see which page flashed without flooding quota.
    tracesSampleRate: 0.1,
    // Never attach IP / request bodies (this app has phones + payments).
    sendDefaultPii: false,
    // Record a small slice of sessions; always record when a crash happens.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.replayIntegration({
        // Mask every text node — names, phones, SMS, dollar amounts.
        maskAllText: true,
        // Block images/video so job photos and receipts never leave the device.
        blockAllMedia: true,
        // Keep console + network metadata so we can still debug flashes.
        networkDetailAllowUrls: [typeof window !== "undefined" ? window.location.origin : ""],
      }),
    ],
    ignoreErrors: [
      // Hydration mismatch copy (React 19 / Next).
      /hydrat/i,
      // Minified hydration-only codes — not #185 render loops.
      /Minified React error #(418|422|423|425)\b/,
    ],
    beforeSend(event) {
      const message = event.exception?.values?.[0]?.value ?? event.message ?? ""
      if (typeof message === "string" && isNoisyHydrationWarning(message)) {
        return null
      }
      return event
    },
  })
}

/** Report App Router navigations as Sentry spans. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
