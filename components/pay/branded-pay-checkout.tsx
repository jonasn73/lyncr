"use client"

// Customer-facing pay page — Lyncr chrome + Stripe Embedded Checkout (URL stays on lyncr.app).

import { useCallback, useEffect, useMemo, useState } from "react"
import { loadStripe } from "@stripe/stripe-js"
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { SITE_NAME } from "@/lib/brand"

function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

type PayPayload =
  | {
      status: "open"
      client_secret: string
      publishable_key: string
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
    return loadStripe(payload.publishable_key)
  }, [payload])

  return (
    <main className="min-h-dvh bg-[#0b1220] text-slate-100">
      <div className="mx-auto flex w-full max-w-lg flex-col px-4 pb-16 pt-8 sm:px-6">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/90">
          {SITE_NAME}
        </p>

        {loading ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            <p className="text-sm">Loading secure payment…</p>
          </div>
        ) : error ? (
          <div className="mt-12 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-6 text-center">
            <h1 className="text-lg font-semibold text-red-100">Link unavailable</h1>
            <p className="mt-2 text-sm text-red-200/90">{error}</p>
            <p className="mt-4 text-xs text-slate-500">
              Ask the business to send a new payment link.
            </p>
          </div>
        ) : payload?.status === "paid" ? (
          <div className="mt-12 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-8 text-center">
            <h1 className="text-2xl font-bold text-white">Payment received</h1>
            <p className="mt-2 text-sm text-emerald-100/90">
              Thanks — {payload.business_label} received {fmtUsd(payload.charge_cents)}.
            </p>
            <Link
              href="/pay/thanks"
              className="mt-6 inline-flex rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Done
            </Link>
          </div>
        ) : payload?.status === "open" && stripePromise ? (
          <>
            <header className="mt-6 text-center">
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {payload.business_label}
              </h1>
              <p className="mt-2 text-sm text-slate-400">Secure payment request</p>
              <p className="mt-4 text-4xl font-bold tabular-nums text-emerald-300">
                {fmtUsd(payload.charge_cents)}
              </p>
              {payload.customer_name ? (
                <p className="mt-2 text-sm text-slate-500">For {payload.customer_name}</p>
              ) : null}
            </header>

            <div className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/40">
              <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={{ clientSecret: payload.client_secret }}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>

            <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-500">
              Your card details are encrypted. You’ll return here when payment is complete.
            </p>
          </>
        ) : null}
      </div>
    </main>
  )
}
