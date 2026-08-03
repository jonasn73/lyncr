"use client"

// Customer-facing pay page — CustomerPortalShell + Stripe Embedded Checkout (URL stays on lyncr.app).

import { useCallback, useEffect, useMemo, useState } from "react"
import { loadStripe } from "@stripe/stripe-js"
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { CustomerPortalShell } from "@/components/customer-portal-shell"

function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

type PayPayload =
  | {
      status: "open"
      client_secret: string
      publishable_key: string
      stripe_account_id?: string | null
      business_label: string
      charge_cents: number
      customer_name: string
    }
  | {
      status: "paid"
      business_label: string
      charge_cents: number
    }
  | {
      status: "redirect"
      redirect_url: string
      business_label: string
      charge_cents: number
    }

export function BrandedPayCheckout({ token }: { token: string }) {
  const [payload, setPayload] = useState<PayPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}`, {
        cache: "no-store",
      })
      const json = (await res.json()) as { error?: string; data?: PayPayload }
      if (!res.ok || !json.data) {
        throw new Error(json.error || "Could not open this payment link.")
      }
      if (json.data.status === "redirect" && json.data.redirect_url) {
        window.location.href = json.data.redirect_url
        return
      }
      setPayload(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open this payment link.")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const stripePromise = useMemo(() => {
    if (!payload || payload.status !== "open") return null
    const acct = payload.stripe_account_id?.trim()
    return loadStripe(
      payload.publishable_key,
      acct ? { stripeAccount: acct } : undefined
    )
  }, [payload])

  const businessName =
    payload && "business_label" in payload ? payload.business_label : null
  const currentStep = payload?.status === "paid" ? "done" : "pay"

  return (
    <CustomerPortalShell
      businessName={businessName}
      mode="pay"
      currentStep={currentStep}
      subtitle={
        payload?.status === "paid"
          ? "Payment complete — thank you."
          : "Secure payment request"
      }
    >
      {loading ? (
        <div className="flex flex-col items-center gap-3 text-zinc-400">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          <p className="text-sm">Loading secure payment…</p>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-6 text-center">
          <h2 className="text-lg font-semibold text-red-100">Link unavailable</h2>
          <p className="mt-2 text-sm text-red-200/90">{error}</p>
          <p className="mt-4 text-xs text-zinc-500">
            Ask the business to send a new payment link.
          </p>
        </div>
      ) : payload?.status === "paid" ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-8 text-center">
          <p className="text-2xl font-bold text-white">Payment received</p>
          <p className="mt-2 text-sm text-emerald-100/90">
            Thanks — {payload.business_label} received {fmtUsd(payload.charge_cents)}.
          </p>
          <p className="mt-3 text-xs text-zinc-400">
            After your visit, you may get a text with a review link — same branded page as this one.
          </p>
          <Link
            href="/pay/thanks"
            className="mt-6 inline-flex rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-500"
          >
            Done
          </Link>
        </div>
      ) : payload?.status === "open" && stripePromise ? (
        <>
          <div className="text-center">
            <p className="text-4xl font-bold tabular-nums text-amber-300">
              {fmtUsd(payload.charge_cents)}
            </p>
            {payload.customer_name ? (
              <p className="mt-2 text-sm text-zinc-500">For {payload.customer_name}</p>
            ) : null}
          </div>

          <div className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/40">
            <EmbeddedCheckoutProvider
              stripe={stripePromise}
              options={{ clientSecret: payload.client_secret }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>

          <p className="mt-6 text-center text-[11px] leading-relaxed text-zinc-500">
            Pay with card, Apple Pay, Google Pay, Cash App, or Link when those methods are on for
            this shop. On iPhone Safari, Apple Pay shows when available. You&apos;ll stay on this
            site when payment is complete.
          </p>
        </>
      ) : null}
    </CustomerPortalShell>
  )
}
