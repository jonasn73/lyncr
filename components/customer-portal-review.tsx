"use client"

// Branded interstitial for /rv/{token} — same chrome as book/pay, then continue to Google.

import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { CustomerPortalShell } from "@/components/customer-portal-shell"

type Props = {
  destinationUrl: string
  businessName: string | null
  /** When the token is missing/invalid — still show calm chrome. */
  invalid?: boolean
}

export function CustomerPortalReview({
  destinationUrl,
  businessName,
  invalid = false,
}: Props) {
  const [seconds, setSeconds] = useState(4)

  useEffect(() => {
    if (invalid || !destinationUrl) return
    if (seconds <= 0) {
      window.location.href = destinationUrl
      return
    }
    const t = window.setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [seconds, destinationUrl, invalid])

  if (invalid) {
    return (
      <CustomerPortalShell
        businessName={businessName}
        mode="review"
        currentStep="review"
        subtitle="This review link is no longer available."
        centered
      >
        <div className="rounded-xl border border-border bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">
          Ask the business to send a fresh thank-you text if you still want to leave a review.
        </div>
      </CustomerPortalShell>
    )
  }

  return (
    <CustomerPortalShell
      businessName={businessName}
      mode="review"
      currentStep="review"
      subtitle="Thanks for choosing us — a quick review helps a lot."
      centered
    >
      <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 px-4 py-6 text-center">
        <p className="text-sm text-foreground">
          You&apos;ll open Google (or the business review page) next. Continues in{" "}
          <span className="font-semibold tabular-nums text-emerald-200">{seconds}s</span>.
        </p>
        <a
          href={destinationUrl}
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-6 text-sm font-semibold text-white hover:bg-amber-500 sm:w-auto"
        >
          Leave a review
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
        <p className="mt-3 text-2xs text-muted-foreground">Same link from your text — powered by lyncr.</p>
      </div>
    </CustomerPortalShell>
  )
}
