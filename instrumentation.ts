// Next.js server instrumentation — loads Sentry for Node + Edge.

import * as Sentry from "@sentry/nextjs"

/** Called once when the server starts (Node or Edge). */
export async function register() {
  // Node API routes + SSR.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
  }
  // Middleware / edge routes.
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

/** Report uncaught request errors to Sentry (App Router). */
export const onRequestError = Sentry.captureRequestError
