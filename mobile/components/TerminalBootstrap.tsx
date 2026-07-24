/**
 * Must sit under StripeTerminalProvider. Calls initialize() once so Tap to Pay works.
 */

import { useEffect, type ReactNode } from "react"
import { useStripeTerminal } from "@stripe/stripe-terminal-react-native"

/** Initializes the Stripe Terminal SDK after the provider mounts. */
export function TerminalBootstrap({ children }: { children: ReactNode }) {
  // Hook exposes initialize + reader helpers from the native SDK.
  const { initialize } = useStripeTerminal()

  useEffect(() => {
    // Kick off native Terminal setup (required before discover/connect).
    void initialize()
  }, [initialize])

  // Render the rest of the app tree unchanged.
  return <>{children}</>
}
