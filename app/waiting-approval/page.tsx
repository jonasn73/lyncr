"use client"

// Shown after public signup until a platform admin Approves the shop.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { BrandWordmark } from "@/components/brand-wordmark"
import { Button } from "@/components/ui/button"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import { accountWaitPath } from "@/lib/account-status"

export default function WaitingApprovalPage() {
  const router = useRouter()
  const [shop, setShop] = useState("")

  useEffect(() => {
    let stop = false
    async function refresh() {
      const res = await fetch("/api/auth/session", { credentials: "include" })
      if (!res.ok) {
        router.replace("/login")
        return
      }
      const json = (await res.json()) as {
        data?: { user?: { business_name?: string; account_status?: string } }
      }
      if (stop) return
      const status = json.data?.user?.account_status
      setShop(String(json.data?.user?.business_name ?? "").trim())
      const wait = accountWaitPath(status)
      if (!wait) {
        router.replace("/onboarding")
        return
      }
      if (wait === "/account-denied") {
        router.replace("/account-denied")
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
    <div className="flex min-h-dvh flex-col bg-background px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-10">
      <BrandWordmark className="text-lg" />
      <h1 className="mt-10 text-2xl font-semibold text-foreground">We got your signup</h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        {shop ? `${shop} is waiting for approval.` : "Your shop is waiting for approval."} You
        can close this page. When we turn you on, log in again and continue setup.
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-8 w-full max-w-sm"
        onClick={() => void signOutAndGoToLogin()}
      >
        Log out
      </Button>
    </div>
  )
}
