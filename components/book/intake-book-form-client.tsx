"use client"

// Customer book-link form — simple intake + (when paid) Embedded Checkout on the same page.

import { useCallback, useEffect, useMemo, useState } from "react"
import { loadStripe } from "@stripe/stripe-js"
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js"
import { Loader2 } from "lucide-react"

type Prefill = {
  customer_name: string
  phone: string
  address: string
  vehicle_year: string
  vehicle_make: string
  vehicle_model: string
  vehicle_text: string
  job_kind: string
  notes: string
}

type InvitePayload = {
  business_label: string
  fee_mode: "none" | "service_call" | "full_quote"
  quote_cents: number
  amount_dollars: number
  fee_label: string
  requires_payment: boolean
  pay_token: string | null
  operator_note: string
  already_submitted: boolean
  prefill: Prefill
}

const JOB_KIND_OPTIONS = [
  { id: "copy", label: "Need a key copy (have a working key)" },
  { id: "akl", label: "All keys lost (AKL)" },
  { id: "lockout", label: "Vehicle lockout" },
  { id: "other", label: "Other" },
] as const

export function IntakeBookFormClient({ inviteId }: { inviteId: string }) {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState<InvitePayload | null>(null)
  const [doneNoPay, setDoneNoPay] = useState(false)

  // After form save — show Embedded Checkout on this same screen
  const [payClientSecret, setPayClientSecret] = useState<string | null>(null)
  const [payPublishableKey, setPayPublishableKey] = useState<string | null>(null)
  const [payStripeAccount, setPayStripeAccount] = useState<string | null>(null)

  const [customerName, setCustomerName] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [year, setYear] = useState("")
  const [make, setMake] = useState("")
  const [model, setModel] = useState("")
  const [vehicleText, setVehicleText] = useState("")
  const [jobKind, setJobKind] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/book/form/${encodeURIComponent(inviteId)}`)
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          data?: InvitePayload
        }
        if (!res.ok || !json.data) throw new Error(json.error || "Could not open this link")
        if (cancelled) return
        setInvite(json.data)
        const p = json.data.prefill
        setCustomerName(p.customer_name || "")
        setPhone(p.phone || "")
        setAddress(p.address || "")
        setYear(p.vehicle_year || "")
        setMake(p.vehicle_make || "")
        setModel(p.vehicle_model || "")
        setVehicleText(p.vehicle_text || "")
        setJobKind(p.job_kind || "")
        setNotes(p.notes || "")
        if (json.data.already_submitted && !json.data.requires_payment) {
          setDoneNoPay(true)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not open this link")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [inviteId])

  const stripePromise = useMemo(() => {
    if (!payPublishableKey) return null
    const acct = payStripeAccount?.trim()
    return loadStripe(payPublishableKey, acct ? { stripeAccount: acct } : undefined)
  }, [payPublishableKey, payStripeAccount])

  const loadCheckout = useCallback(async (payToken: string) => {
    // Reuse Collect pay page API — same wallets (card / Apple Pay / Cash App / Link / Venmo).
    const res = await fetch(`/api/pay/${encodeURIComponent(payToken)}`, { cache: "no-store" })
    const json = (await res.json().catch(() => ({}))) as {
      error?: string
      data?: {
        status?: string
        client_secret?: string
        publishable_key?: string
        stripe_account_id?: string | null
        redirect_url?: string
      }
    }
    if (!res.ok || !json.data) throw new Error(json.error || "Could not open payment")
    if (json.data.status === "redirect" && json.data.redirect_url) {
      window.location.href = json.data.redirect_url
      return
    }
    if (json.data.status === "paid") {
      setDoneNoPay(true)
      return
    }
    if (!json.data.client_secret || !json.data.publishable_key) {
      throw new Error("Payment page missing — ask the shop for a new link")
    }
    setPayClientSecret(json.data.client_secret)
    setPayPublishableKey(json.data.publishable_key)
    setPayStripeAccount(json.data.stripe_account_id ?? null)
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!invite || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/book/form/${encodeURIComponent(inviteId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName,
          phone,
          address,
          vehicle_year: year,
          vehicle_make: make,
          vehicle_model: model,
          vehicle_text: vehicleText,
          job_kind: jobKind,
          notes,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: {
          requires_payment?: boolean
          pay_token?: string | null
          thank_you?: boolean
        }
      }
      if (!res.ok) throw new Error(json.error || "Could not save your info")

      if (json.data?.requires_payment && json.data.pay_token) {
        // Stay on this page — reveal wallet buttons / card form below
        await loadCheckout(json.data.pay_token)
        // Scroll pay block into view on mobile
        requestAnimationFrame(() => {
          document.getElementById("book-link-pay")?.scrollIntoView({ behavior: "smooth", block: "start" })
        })
      } else {
        setDoneNoPay(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-slate-300">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Loading…
      </div>
    )
  }

  if (error && !invite) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <p className="text-lg font-semibold text-white">Link problem</p>
        <p className="mt-2 text-sm text-slate-400">{error}</p>
      </div>
    )
  }

  if (doneNoPay) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center pb-[calc(env(safe-area-inset-bottom)+2rem)]">
        <p className="text-2xl font-semibold text-white">Thanks — you’re all set</p>
        <p className="mt-2 text-sm text-slate-400">
          {invite?.business_label || "The shop"} received your details
          {invite?.requires_payment ? " and payment" : ""}.
        </p>
      </div>
    )
  }

  const amountLabel =
    invite && invite.fee_mode !== "none"
      ? `$${(invite.amount_dollars || 0).toFixed(invite.quote_cents % 100 === 0 ? 0 : 2)}`
      : null

  return (
    <div className="mx-auto max-w-md px-4 py-8 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
        {invite?.business_label || "Your locksmith"}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
        {invite?.fee_mode === "none"
          ? "Finish booking"
          : `Book & pay ${amountLabel}`}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        {invite?.fee_mode === "none"
          ? "Quick form so we have your name, address, and vehicle ready."
          : `Fill this in, then pay ${amountLabel} with Cash App, Apple Pay, card, or Link — all on this page.`}
      </p>
      {invite?.operator_note ? (
        <p className="mt-3 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-300">
          {invite.operator_note}
        </p>
      ) : null}

      {/* Hide the form once checkout is showing so the page stays one short screen */}
      {!payClientSecret ? (
        <form onSubmit={(e) => void onSubmit(e)} className="mt-6 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Your name *</span>
            <input
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
              autoComplete="name"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Phone *</span>
            <input
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
              autoComplete="tel"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Service address *</span>
            <input
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, city, ZIP"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
              autoComplete="street-address"
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Year</span>
              <input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Make</span>
              <input
                value={make}
                onChange={(e) => setMake(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Model</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">
              Or describe vehicle (if not sure of year/make/model)
            </span>
            <input
              value={vehicleText}
              onChange={(e) => setVehicleText(e.target.value)}
              placeholder="e.g. Silver Honda Civic"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-slate-300">What do you need?</legend>
            <div className="grid gap-2">
              {JOB_KIND_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setJobKind(opt.id)}
                  className={
                    jobKind === opt.id
                      ? "rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-2.5 text-left text-sm font-medium text-emerald-50"
                      : "rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-left text-sm text-slate-200"
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
              placeholder="Gate code, parking, key details…"
            />
          </label>

          {error ? <p className="text-sm text-red-300">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-base font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {invite?.fee_mode === "none"
              ? "Submit"
              : `Continue to pay ${amountLabel}`}
          </button>
        </form>
      ) : null}

      {payClientSecret && stripePromise ? (
        <div id="book-link-pay" className="mt-6 space-y-3">
          <p className="text-center text-sm font-medium text-slate-200">
            Pay {amountLabel} — Cash App, Apple Pay, card, or Link
          </p>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/40">
            <EmbeddedCheckoutProvider
              stripe={stripePromise}
              options={{ clientSecret: payClientSecret }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
          <p className="text-center text-[11px] leading-relaxed text-zinc-500">
            On iPhone Safari, Apple Pay shows when available. Cash App and cards work on any device.
          </p>
        </div>
      ) : null}
    </div>
  )
}
