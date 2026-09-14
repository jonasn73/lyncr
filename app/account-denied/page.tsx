"use client"

// Shown when a platform admin denied this shop signup.

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { BrandWordmark } from "@/components/brand-wordmark"
import { Button } from "@/components/ui/button"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import { accountWaitPath } from "@/lib/account-status"

export default function AccountDeniedPage() {
  const router = useRouter()

  useEffect(() => {
    let stop = false
    async function refresh() {
      const res = await fetch("/api/auth/session", { credentials: "include" })
      if (!res.ok) {
        router.replace("/login")
        return
      }
      const json = (await res.json()) as { data?: { user?: { account_status?: string } } }
      if (stop) return
      const wait = accountWaitPath(json.data?.user?.account_status)
      if (wait === "/waiting-approval") {
        router.replace("/waiting-approval")
        return
      }
      if (!wait) {
        router.replace("/onboarding")
      }
    }
    void refresh()
    const id = window.setInterval(() => {
      void refresh()
    }, 20000)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [router])

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-center px-6 py-6">
        <BrandWordmark size="md" />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
        <div className="w-full max-w-sm animate-sigo-page-enter text-center">
          <h1 className="text-2xl font-semibold text-foreground">This shop was not approved</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This Lyncr account cannot be used. If that is a mistake, contact support.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-8 w-full"
            onClick={() => void signOutAndGoToLogin()}
          >
            Log out
          </Button>
        </div>
      </main>
    </div>
  )
}
