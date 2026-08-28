"use client"

// Customer-facing pay page — tip first, then Stripe Embedded Checkout (URL stays on lyncr.app).

import { useCallback, useEffect, useMemo, useState } from "react"
import { loadStripe } from "@stripe/stripe-js"
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { CustomerPortalShell } from "@/components/customer-portal-shell"
import { tipCentsFromChoice, tipLastTotalNote } from "@/lib/payment-slip-ui"
import { cn } from "@/lib/utils"

function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

type TipChoice = "none" | "15" | "18" | "20" | "custom"

type PayPayload =
  | {
      status: "tip"
      business_label: string
      customer_name: string
      base_cents: number
      subtotal_cents?: number
      tax_cents?: number
      note?: string
    }
  | {
      status: "open"
      client_secret: string
      publishable_key: string
      stripe_account_id?: string | null
      business_label: string
      charge_cents: number
      customer_name: string
      tip_cents?: number
      base_cents?: number
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
  // Tip chips (same options as in-person Collect).
  const [tipChoice, setTipChoice] = useState<TipChoice>("none")
  const [customTipDollars, setCustomTipDollars] = useState("")
  const [tipBusy, setTipBusy] = useState(false)

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

  const baseCents =
    payload?.status === "tip"
      ? payload.base_cents
      : payload?.status === "open" && typeof payload.base_cents === "number"
        ? payload.base_cents
        : 0

  const selectedTipCents = useMemo(() => {
    if (payload?.status !== "tip") return 0
    return tipCentsFromChoice(tipChoice, baseCents, customTipDollars)
  }, [payload, tipChoice, baseCents, customTipDollars])

  const totalWithTip = baseCents + selectedTipCents

  // After tip Confirm: create Checkout for job+tip, then show Embedded Checkout.
  const confirmTip = useCallback(async () => {
    setTipBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipCents: selectedTipCents }),
      })
      const json = (await res.json()) as { error?: string; data?: PayPayload }
      if (!res.ok || !json.data || json.data.status !== "open") {
        throw new Error(json.error || "Could not start payment.")
      }
      setPayload(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start payment.")
    } finally {
      setTipBusy(false)
    }
  }, [token, selectedTipCents])

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
          : payload?.status === "tip"
            ? "Add a tip, then pay securely"
            : "Secure payment request"
      }
    >
      {loading ? (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          <p className="text-sm">Loading secure payment…</p>
        </div>
      ) : error && payload?.status !== "tip" ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-6 py-6 text-center">
          <h2 className="text-lg font-semibold text-red-100">Link unavailable</h2>
          <p className="mt-2 text-sm text-red-200/90">{error}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            Ask the business to send a new payment link.
          </p>
        </div>
      ) : payload?.status === "paid" ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-6 py-8 text-center">
          <p className="text-2xl font-bold text-white">Payment received</p>
          <p className="mt-2 text-sm text-emerald-100/90">
            Thanks — {payload.business_label} received {fmtUsd(payload.charge_cents)}.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            A receipt is on the way by email and text when we have your contact info.
          </p>
          <Link
            href="/pay/thanks"
            className="mt-6 inline-flex rounded-xl bg-amber-600 px-6 py-3 text-sm font-semibold text-white hover:bg-amber-500"
          >
            Done
          </Link>
        </div>
      ) : payload?.status === "tip" ? (
        <div className="space-y-6">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Service total</p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-amber-300">
              {fmtUsd(baseCents)}
            </p>
            {payload.customer_name ? (
              <p className="mt-2 text-sm text-muted-foreground">For {payload.customer_name}</p>
            ) : null}
            {(payload.tax_cents ?? 0) > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Includes {fmtUsd(payload.tax_cents!)} tax
              </p>
            ) : null}
          </div>

          <div>
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Add a tip
            </p>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              {(
                [
                  { id: "none" as const, label: "No tip" },
                  { id: "15" as const, label: "15%" },
                  { id: "18" as const, label: "18%" },
                  { id: "20" as const, label: "20%" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTipChoice(opt.id)}
                  className={cn(
                    "rounded-xl border py-2 text-xs font-semibold transition-colors",
                    tipChoice === opt.id
                      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                      : "border-border bg-card text-muted-foreground"
                  )}
                >
                  {opt.label}
                  {opt.id !== "none" && baseCents > 0 ? (
                    <span className="mt-0.5 block text-micro font-normal tabular-nums opacity-80">
                      {fmtUsd(tipCentsFromChoice(opt.id, baseCents, customTipDollars))}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setTipChoice("custom")}
              className={cn(
                "mt-1.5 w-full rounded-xl border py-2 text-xs font-semibold transition-colors",
                tipChoice === "custom"
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                  : "border-border bg-card text-muted-foreground"
              )}
            >
              Custom tip
            </button>
            {tipChoice === "custom" ? (
              <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                <span className="text-sm font-semibold text-muted-foreground">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={customTipDollars}
                  onChange={(e) => setCustomTipDollars(e.target.value)}
                  className="w-full bg-transparent text-sm font-semibold tabular-nums text-white outline-none"
                />
              </div>
            ) : null}
            <p className="mt-2 text-xs leading-snug text-emerald-200/90">
              {tipLastTotalNote({
                totalAmountLabel: fmtUsd(totalWithTip),
                tipCents: selectedTipCents,
                tipAmountLabel: fmtUsd(selectedTipCents),
                baseAmountLabel: fmtUsd(baseCents),
              })}
            </p>
          </div>

          {error ? (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-center text-sm text-red-100">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            disabled={tipBusy}
            onClick={() => void confirmTip()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-emerald-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {tipBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Preparing payment…
              </>
            ) : (
              `Continue · ${fmtUsd(totalWithTip)}`
            )}
          </button>
          <p className="text-center text-2xs leading-relaxed text-muted-foreground">
            Next you&apos;ll enter card or wallet details. Nothing is charged until you finish
            payment.
          </p>
        </div>
      ) : payload?.status === "open" && stripePromise ? (
        <>
          <div className="text-center">
            <p className="text-4xl font-bold tabular-nums text-amber-300">
              {fmtUsd(payload.charge_cents)}
            </p>
            {typeof payload.tip_cents === "number" && payload.tip_cents > 0 ? (
              <p className="mt-1 text-xs text-emerald-200/90">
                Includes {fmtUsd(payload.tip_cents)} tip
              </p>
            ) : null}
            {payload.customer_name ? (
              <p className="mt-2 text-sm text-muted-foreground">For {payload.customer_name}</p>
            ) : null}
          </div>

          {/* min-h reserves space for the embedded iframe, which renders at 0 height until
              Stripe's async load finishes — without it the page jumps when it appears. */}
          <div className="mt-8 min-h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/40">
            <EmbeddedCheckoutProvider
              stripe={stripePromise}
              options={{ clientSecret: payload.client_secret }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>

          <p className="mt-6 text-center text-2xs leading-relaxed text-muted-foreground">
            Pay with card, Apple Pay, Google Pay, Cash App, or Link when those methods are on for
            this shop. On iPhone Safari, Apple Pay shows when available. You&apos;ll stay on this
            site when payment is complete. A receipt is sent automatically by email and text.
          </p>
        </>
      ) : null}
    </CustomerPortalShell>
  )
}
