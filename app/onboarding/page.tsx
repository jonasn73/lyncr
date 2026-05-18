"use client"

import { OnboardingPage } from "@/components/onboarding-page"

/** Post-signup wizard — requires a session (see middleware). */
export default function OnboardingRoutePage() {
  return (
    <OnboardingPage
      onComplete={() => {
        // Full navigation so the dashboard server layout re-reads Neon `profiles` (avoids stale client route + redirect errors).
        window.location.assign("/dashboard")
      }}
    />
  )
}
