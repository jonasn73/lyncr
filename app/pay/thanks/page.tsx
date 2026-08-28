// Public page after the customer pays via a branded Collect Payment link.

"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { CustomerPortalShell } from "@/components/customer-portal-shell"

function formatUsd(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })
}

function PayThanksInner() {
  const searchParams = useSearchParams()
  const sessionId = (searchParams.get("session_id") || "").trim()
  const [status, setStatus] = useState<"loading" | "paid" | "pending" | "error">("loading")
  const [amountLabel, setAmountLabel] = useState<string | null>(null)
  const [businessLabel, setBusinessLabel] = useState<string | null>(null)

  // Backup: tell Lyncr the Checkout session finished (in case the Stripe webhook was late).
  useEffect(() => {
    if (!sessionId.startsWith("cs_")) {
      setStatus("paid")
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/pay/confirm-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          data?: {
            paymentStatus?: string
            walletSettled?: boolean
            chargeCents?: number
            businessLabel?: string
            customerName?: string
          }
          error?: string
        }
        if (cancelled) return
        if (!res.ok) {
          setStatus("pending")
          return
        }
        const cents = json.data?.chargeCents
        if (typeof cents === "number" && cents > 0) {
          setAmountLabel(formatUsd(cents))
        }
        const biz = (json.data?.businessLabel || "").trim()
        if (biz) setBusinessLabel(biz)

        if (json.data?.walletSettled || json.data?.paymentStatus === "paid") {
          setStatus("paid")
        } else {
          setStatus("pending")
        }
      } catch {
        if (!cancelled) setStatus("pending")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const shop = businessLabel || "the shop"
  const subtitle =
    status === "loading"
      ? "One moment — confirming your payment…"
      : status === "pending"
        ? "Your payment is processing. You’re all set — you can close this window."
        : amountLabel
          ? `Thanks! We received ${amountLabel}. You’re all set.`
          : "Thanks! Your payment went through. You’re all set."

  return (
    <CustomerPortalShell
      businessName={businessLabel || "Payment received"}
      mode="pay"
      currentStep="done"
      subtitle={subtitle}
      centered
    >
      <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 px-4 py-6 text-center">
        <p className="text-base font-semibold text-emerald-100">
          {status === "loading"
            ? "Confirming…"
            : status === "pending"
              ? "Payment received — almost confirmed"
              : "You’re paid up"}
        </p>
        {status === "loading" ? null : (
          // Always rendered once status resolves (even with a blank placeholder) so this line's
          // height is reserved from the start — appearing as a brand-new element once amountLabel
          // arrives shifted the paragraph below it (real CLS, not just a text swap).
          <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-200">
            {amountLabel || " "}
          </p>
        )}
        <p className="mt-3 text-sm leading-relaxed text-emerald-200/85">
          {status === "loading"
            ? "Hang tight while we confirm with the card network."
            : `Thank you for choosing ${shop}. A receipt is sent automatically by email and text when we have your contact info.`}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          After the job, you may get a short thank-you text with a review link. You can close this
          page anytime.
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
          <p className="text-center text-sm text-muted-foreground">Confirming payment…</p>
        </CustomerPortalShell>
      }
    >
      <PayThanksInner />
    </Suspense>
  )
}
