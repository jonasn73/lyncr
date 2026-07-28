// Public page after the customer pays via a branded Collect Payment link.

"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { CustomerPortalShell } from "@/components/customer-portal-shell"

function PayThanksInner() {
  const searchParams = useSearchParams()
  const sessionId = (searchParams.get("session_id") || "").trim()
  const [note, setNote] = useState<string | null>(null)

  // Backup: tell Lyncr the Checkout session finished (in case the Stripe webhook was late).
  useEffect(() => {
    if (!sessionId.startsWith("cs_")) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/pay/confirm-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          data?: { paymentStatus?: string; walletSettled?: boolean }
          error?: string
        }
        if (cancelled) return
        if (!res.ok) {
          setNote("Payment may still be processing — the business will see it shortly.")
          return
        }
        if (json.data?.walletSettled || json.data?.paymentStatus === "paid") {
          setNote("Payment confirmed.")
        }
      } catch {
        if (!cancelled) {
          setNote("Payment may still be processing — the business will see it shortly.")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  return (
    <CustomerPortalShell
      businessName="Payment received"
      mode="pay"
      currentStep="done"
      subtitle="Thanks — your payment went through. You can close this window."
      centered
    >
      <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 px-4 py-5 text-center">
        {note ? <p className="text-sm text-emerald-200/90">{note}</p> : null}
        <p className="mt-2 text-xs text-zinc-400">
          After the job, watch for a thank-you text with a review link — same lyncr page style.
        </p>
      </div>
    </CustomerPortalShell>
  )
}

export default function PayThanksPage() {
  return (
    <Suspense
      fallback={
        <CustomerPortalShell
          businessName="Confirming payment"
          mode="pay"
          currentStep="pay"
          subtitle="One moment…"
          centered
        >
          <p className="text-center text-sm text-zinc-400">Confirming payment…</p>
        </CustomerPortalShell>
      }
    >
      <PayThanksInner />
    </Suspense>
  )
}
