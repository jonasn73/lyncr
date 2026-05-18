// ============================================
// Onboarding Telnyx provision mode (simulation vs live carrier)
// ============================================
// Trial/dev: numbers are reserved in Neon only — no Telnyx number_orders call.
// Production: set ONBOARDING_LIVE_TELNYX_PROVISION=true in Vercel to buy + wire webhooks at launch.

/** True while onboarding must NOT place live Telnyx carrier orders (default). */
export function isOnboardingTelnyxSimulationMode(): boolean {
  return process.env.ONBOARDING_LIVE_TELNYX_PROVISION?.trim().toLowerCase() !== "true"
}

export const ONBOARDING_DEV_MODE_NOTICE =
  "Development Mode: Number reserved in Neon DB. Live Telnyx webhooks require production API key mapping."
