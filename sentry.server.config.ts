// Node.js Sentry init — loaded from instrumentation.ts on the server runtime.

import * as Sentry from "@sentry/nextjs"
import { isNoisyHydrationWarning, resolveSentryDsn, shouldEnableSentry } from "@/lib/sentry-config"

// Read DSN once so we can skip init entirely when unset.
const dsn = resolveSentryDsn()

// Only start in production with a real DSN (local dev keeps DevErrorLogDrawer).
if (shouldEnableSentry({ dsn })) {
  Sentry.init({
    // Same DSN as the browser unless SENTRY_DSN is set separately.
    dsn,
    // Sample a slice of server traces — enough to debug flashes, not every request.
    tracesSampleRate: 0.1,
    // Never send default PII (phones, SMS bodies, payment amounts).
    sendDefaultPii: false,
    // Drop hydration noise; keep real 500s.
    ignoreErrors: [],
    beforeSend(event) {
      // Pull the first exception message if present.
      const message = event.exception?.values?.[0]?.value ?? event.message ?? ""
      // Hydration warnings are client-only, but filter anyway if they leak here.
      if (typeof message === "string" && isNoisyHydrationWarning(message)) {
        return null
      }
      return event
    },
  })
}
