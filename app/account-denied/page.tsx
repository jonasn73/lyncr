"use client"

// Shown when a platform admin denied this shop signup.

import { BrandWordmark } from "@/components/brand-wordmark"
import { Button } from "@/components/ui/button"
import { signOutAndGoToLogin } from "@/lib/client-auth"

export default function AccountDeniedPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-10">
      <BrandWordmark className="text-lg" />
      <h1 className="mt-10 text-2xl font-semibold text-foreground">This shop was not approved</h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        This Lyncr account cannot be used. If that is a mistake, contact support.
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
