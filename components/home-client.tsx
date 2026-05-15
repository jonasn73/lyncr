"use client"

// ============================================
// Home (logged-out): login / signup / onboarding
// ============================================
// Session redirect runs on the server in `app/page.tsx` — this file only mounts when
// there is no valid session cookie, so we do not show a full-screen "Loading…" gate.

import { useRouter } from "next/navigation"
import { AuthPage } from "@/components/auth-pages"
import { OnboardingPage } from "@/components/onboarding-page"
import { ErrorBoundary } from "@/components/error-boundary"
import { useState } from "react"

type AppView = "login" | "signup" | "onboarding"

export function HomeClient() {
  const router = useRouter()
  const [view, setView] = useState<AppView>("login")

  function handleNavigate(page: string) {
    if (page === "login" || page === "signup" || page === "onboarding") {
      setView(page)
    }
  }

  function handleAuth(ctx?: { operator_access?: boolean }) {
    router.replace(ctx?.operator_access ? "/admin" : "/dashboard")
  }

  function handleSignup() {
    setView("onboarding")
  }

  function handleOnboardingComplete() {
    router.replace("/dashboard")
  }

  return (
    <ErrorBoundary>
      {view === "login" || view === "signup" ? (
        <AuthPage
          mode={view}
          onNavigate={handleNavigate}
          onAuth={view === "signup" ? handleSignup : handleAuth}
        />
      ) : (
        <OnboardingPage onComplete={handleOnboardingComplete} />
      )}
    </ErrorBoundary>
  )
}
