// Edge runtime Sentry init — middleware / edge routes.

import * as Sentry from "@sentry/nextjs"
import { isNoisyHydrationWarning, resolveSentryDsn, shouldEnableSentry } from "@/lib/sentry-config"

// Resolve DSN the same way as Node + browser.
const dsn = resolveSentryDsn()

// Edge must not init in local dev or when DSN is missing.
if (shouldEnableSentry({ dsn })) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      const message = event.exception?.values?.[0]?.value ?? event.message ?? ""
      if (typeof message === "string" && isNoisyHydrationWarning(message)) {
        return null
      }
      return event
    },
  })
}
