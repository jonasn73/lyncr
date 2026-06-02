"use client"

import { Suspense, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { OnboardingPage } from "@/components/onboarding-page"

function OnboardingRouteInner() {
  const params = useSearchParams()
  // A receptionist invite link (/onboarding?token=…) routes to the public activation form.
  const inviteToken = params.get("token")

  useEffect(() => {
    if (inviteToken) {
      window.location.replace(`/register?token=${encodeURIComponent(inviteToken)}`)
    }
  }, [inviteToken])

  if (inviteToken) return null

  return (
    <OnboardingPage
      onComplete={() => {
        window.location.assign("/dashboard")
      }}
    />
  )
}

/** Post-signup wizard — requires a session (see middleware). */
export default function OnboardingRoutePage() {
  return (
    <Suspense fallback={null}>
      <OnboardingRouteInner />
    </Suspense>
  )
}
