// Interactive job payment modal — invoice breakdown + Tap to Pay / Manual Card / Cash.

"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  Nfc,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { loadStripeTerminal, type Terminal } from "@stripe/terminal-js"
import { cn } from "@/lib/utils"
import type { DispatchJob } from "@/lib/types"

type Line = { id: string; label: string; amount: string }
type PayMethod = "tap" | "card" | "cash"

function newLine(label = "", amount = ""): Line {
  return { id: Math.random().toString(36).slice(2), label, amount }
}

function dollarsToCents(v: string): number {
  const n = Math.round(parseFloat(v || "0") * 100)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function fmt(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

let stripePromise: Promise<Stripe | null> | null = null
function getStripePromise(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey)
  return stripePromise
}

export function TechPaymentModal(props: {
  job: DispatchJob
  onClose: () => void
  onCompleted: () => void
}) {
  const [lines, setLines] = useState<Line[]>([
    newLine("Key Cut", "250"),
    newLine("Programming", "125"),
  ])
  const [method, setMethod] = useState<PayMethod | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [tapListening, setTapListening] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [publishableKey, setPublishableKey] = useState<string | null>(null)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)

  const subtotalCents = useMemo(
    () => lines.reduce((sum, l) => sum + dollarsToCents(l.amount), 0),
    [lines]
  )
  const totalCents = subtotalCents

  const lineItemsPayload = () =>
    lines
      .map((l) => ({ label: l.label.trim(), amountCents: dollarsToCents(l.amount) }))
      .filter((l) => l.label && l.amountCents > 0)

  async function createIntent(paymentMethodType: "TAP_TO_PAY" | "MANUAL_CARD") {
    const lineItems = lineItemsPayload()
    if (lineItems.length === 0) throw new Error("Add at least one line item with an amount.")
    const res = await fetch("/api/payments/create-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        jobId: props.job.id,
        amount: totalCents / 100,
        paymentMethodType,
        invoiceOverride: true,
        lineItems,
      }),
    })
    const json = (await res.json()) as {
      error?: string
      data?: {
        clientSecret?: string
        client_secret?: string
        paymentIntentId?: string
        publishableKey?: string | null
      }
    }
    if (!res.ok) throw new Error(json.error || "Could not start payment")
    const secret = json.data?.clientSecret || json.data?.client_secret
    if (!secret) throw new Error("No client_secret returned")
    setClientSecret(secret)
    setPaymentIntentId(json.data?.paymentIntentId ?? null)
    setPublishableKey(json.data?.publishableKey?.trim() || null)
    return {
      clientSecret: secret,
      paymentIntentId: json.data?.paymentIntentId ?? null,
      publishableKey: json.data?.publishableKey?.trim() || null,
    }
  }

  async function confirmServer(piId: string) {
    const res = await fetch("/api/payments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ paymentIntentId: piId }),
    })
    const json = (await res.json()) as { error?: string }
    if (!res.ok) throw new Error(json.error || "Could not confirm payment")
  }

  async function saveCashInvoice() {
    const lineItems = lineItemsPayload()
    if (lineItems.length === 0) throw new Error("Add at least one line item with an amount.")
    const res = await fetch("/api/tech/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        leadId: props.job.id,
        lineItems,
        taxCents: 0,
        paymentMethod: "cash",
        collectNow: true,
      }),
    })
    const json = (await res.json()) as { error?: string }
    if (!res.ok) throw new Error(json.error || "Could not record cash payment")
  }

  async function runTapToPay() {
    setError(null)
    setBusy(true)
    setTapListening(true)
    setMethod("tap")
    let terminal: Terminal | null = null
    try {
      const intent = await createIntent("TAP_TO_PAY")
      const StripeTerminal = await loadStripeTerminal()
      if (!StripeTerminal) throw new Error("Stripe Terminal SDK failed to load")

      terminal = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const res = await fetch("/api/payments/terminal/connection-token", {
            method: "POST",
            credentials: "include",
          })
          const json = (await res.json()) as { data?: { secret?: string }; error?: string }
          if (!res.ok || !json.data?.secret) {
            throw new Error(json.error || "Could not fetch Terminal connection token")
          }
          return json.data.secret
        },
        onUnexpectedReaderDisconnect: () => {
          setError("Card reader disconnected. Try again or use Manual Card Entry.")
          setTapListening(false)
        },
      })

      // Prefer a real reader; fall back to Stripe's simulated reader (test mode).
      let discover = await terminal.discoverReaders({ simulated: false })
      if ("error" in discover || !("discoveredReaders" in discover) || !discover.discoveredReaders?.length) {
        discover = await terminal.discoverReaders({ simulated: true })
      }
      if ("error" in discover) throw new Error(discover.error.message)
      const reader = discover.discoveredReaders?.[0]
      if (!reader) {
        throw new Error(
          "No NFC reader available in this browser. Use Manual Card Entry, or open Tap to Pay in the native tech app on a supported phone."
        )
      }

      const connected = await terminal.connectReader(reader)
      if ("error" in connected) throw new Error(connected.error.message)

      const collected = await terminal.collectPaymentMethod(intent.clientSecret)
      if ("error" in collected) throw new Error(collected.error.message)

      const processed = await terminal.processPayment(collected.paymentIntent)
      if ("error" in processed) throw new Error(processed.error.message)

      const piId = String(processed.paymentIntent?.id || intent.paymentIntentId || "")
      if (piId) await confirmServer(piId)

      // Persist invoice line items; wallet already credited via PaymentIntent confirm.
      await fetch("/api/tech/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          leadId: props.job.id,
          lineItems: lineItemsPayload(),
          taxCents: 0,
          paymentMethod: "card",
          collectNow: true,
          skipWalletCredit: true,
        }),
      }).catch(() => {})

      setDone(true)
      setTimeout(props.onCompleted, 900)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tap to Pay failed")
      setMethod(null)
    } finally {
      setTapListening(false)
      setBusy(false)
      try {
        await terminal?.disconnectReader()
      } catch {
        /* ignore */
      }
    }
  }

  async function startManualCard() {
    setError(null)
    setBusy(true)
    setMethod("card")
    try {
      await createIntent("MANUAL_CARD")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start card payment")
      setMethod(null)
    } finally {
      setBusy(false)
    }
  }

  async function payCash() {
    setError(null)
    setBusy(true)
    setMethod("cash")
    try {
      await saveCashInvoice()
      setDone(true)
      setTimeout(props.onCompleted, 900)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record cash payment")
      setMethod(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      {tapListening ? (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#0b0b12]/95 px-8 text-center">
          <div className="relative mb-6 flex h-28 w-28 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-indigo-500/30" />
            <span className="relative flex h-24 w-24 items-center justify-center rounded-full border border-indigo-400/40 bg-indigo-500/15">
              <Nfc className="h-10 w-10 text-indigo-200" aria-hidden />
            </span>
          </div>
          <Loader2 className="mb-4 h-6 w-6 animate-spin text-indigo-300" aria-hidden />
          <p className="text-lg font-semibold text-white">Hold card to back of phone…</p>
          <p className="mt-2 max-w-xs text-sm text-zinc-400">
            Keep the contactless card or wallet still until the charge completes.
          </p>
          <p className="mt-4 font-mono text-xl font-bold text-emerald-300">{fmt(totalCents)}</p>
        </div>
      ) : null}

      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-zinc-800 bg-[#101018] sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-white">Proceed to Payment</h2>
            <p className="text-xs text-zinc-500">
              {props.job.customer_name || props.job.customer_phone || "Customer"}
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            disabled={busy || tapListening}
            className="rounded-lg p-2 text-zinc-400 hover:text-white disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            <p className="mt-3 text-lg font-semibold text-white">Payment complete</p>
            <p className="mt-1 text-sm text-zinc-400">{fmt(totalCents)} · job closed</p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Invoice breakdown
                </p>
                <div className="space-y-2">
                  {lines.map((line) => (
                    <div key={line.id} className="flex items-center gap-2">
                      <input
                        value={line.label}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) => (l.id === line.id ? { ...l, label: e.target.value } : l))
                          )
                        }
                        placeholder="Description"
                        disabled={busy || method === "card"}
                        className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500 disabled:opacity-60"
                      />
                      <div className="relative w-28 shrink-0">
                        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-zinc-500">
                          $
                        </span>
                        <input
                          value={line.amount}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l) =>
                                l.id === line.id
                                  ? { ...l, amount: e.target.value.replace(/[^\d.]/g, "") }
                                  : l
                              )
                            )
                          }
                          inputMode="decimal"
                          placeholder="0.00"
                          disabled={busy || method === "card"}
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 pr-2 pl-6 text-right text-sm text-white outline-none focus:border-indigo-500 disabled:opacity-60"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== line.id) : prev))
                        }
                        disabled={lines.length === 1 || busy || method === "card"}
                        className="shrink-0 rounded-lg p-2 text-zinc-500 hover:text-red-400 disabled:opacity-30"
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={busy || method === "card"}
                  onClick={() => setLines((prev) => [...prev, newLine()])}
                  className="mt-3 inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" /> Add line
                </button>
                <div className="mt-4 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                  <span className="text-sm font-medium text-zinc-400">Total</span>
                  <span className="text-lg font-bold text-white">{fmt(totalCents)}</span>
                </div>
              </section>

              {method === "card" ? null : (
                <section>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Payment options
                  </p>
                  <div className="grid gap-2">
                    <PayOptionButton
                      active={method === "tap"}
                      disabled={busy || totalCents < 50}
                      onClick={() => void runTapToPay()}
                      title="Tap to Pay"
                      subtitle="NFC — hold card to back of phone"
                      icon={<Nfc className="h-5 w-5" />}
                    />
                    <PayOptionButton
                      active={false}
                      disabled={busy || totalCents < 50}
                      onClick={() => void startManualCard()}
                      title="Manual Card Entry"
                      subtitle="Secure Stripe card fields"
                      icon={<CreditCard className="h-5 w-5" />}
                    />
                    <PayOptionButton
                      active={method === "cash"}
                      disabled={busy || totalCents < 50}
                      onClick={() => void payCash()}
                      title="Cash / Alternative"
                      subtitle="Mark paid without charging a card"
                      icon={<Banknote className="h-5 w-5" />}
                    />
                  </div>
                </section>
              )}

              {method === "card" && clientSecret && publishableKey ? (
                <Elements
                  stripe={getStripePromise(publishableKey)}
                  options={{
                    clientSecret,
                    appearance: {
                      theme: "night",
                      variables: { colorPrimary: "#6366f1", borderRadius: "10px" },
                    },
                  }}
                >
                  <ManualCardForm
                    totalLabel={fmt(totalCents)}
                    paymentIntentId={paymentIntentId}
                    lineItems={lineItemsPayload()}
                    jobId={props.job.id}
                    onError={setError}
                    onSuccess={() => {
                      setDone(true)
                      setTimeout(props.onCompleted, 900)
                    }}
                    onBack={() => {
                      setMethod(null)
                      setClientSecret(null)
                      setPaymentIntentId(null)
                    }}
                  />
                </Elements>
              ) : null}

              {method === "card" && (!clientSecret || !publishableKey) && busy ? (
                <div className="flex items-center justify-center gap-2 py-8 text-zinc-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Preparing secure card form…
                </div>
              ) : null}

              {method === "card" && !publishableKey && !busy ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  Add <span className="font-mono">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</span> in Vercel to
                  enable Manual Card Entry.
                </p>
              ) : null}

              {error ? (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PayOptionButton(props: {
  title: string
  subtitle: string
  icon: React.ReactNode
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition active:scale-[0.99] disabled:opacity-50",
        props.active
          ? "border-indigo-500 bg-indigo-500/15"
          : "border-zinc-700 bg-zinc-800/40 hover:border-zinc-600"
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-950/60 text-indigo-300">
        {props.icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white">{props.title}</span>
        <span className="block text-[11px] text-zinc-500">{props.subtitle}</span>
      </span>
    </button>
  )
}

function ManualCardForm(props: {
  totalLabel: string
  paymentIntentId: string | null
  jobId: string
  lineItems: { label: string; amountCents: number }[]
  onError: (msg: string | null) => void
  onSuccess: () => void
  onBack: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    props.onError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear once when form mounts
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    props.onError(null)
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {
          return_url:
            typeof window !== "undefined"
              ? `${window.location.origin}/tech/dashboard`
              : undefined,
        },
      })
      if (error) {
        props.onError(error.message || "Card payment failed")
        return
      }
      const piId = paymentIntent?.id || props.paymentIntentId
      if (piId) {
        const res = await fetch("/api/payments/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ paymentIntentId: piId }),
        })
        if (!res.ok) {
          const json = (await res.json()) as { error?: string }
          throw new Error(json.error || "Could not confirm payment")
        }
      }
      await fetch("/api/tech/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          leadId: props.jobId,
          lineItems: props.lineItems,
          taxCents: 0,
          paymentMethod: "card",
          collectNow: true,
          skipWalletCredit: true,
        }),
      }).catch(() => {})
      props.onSuccess()
    } catch (err) {
      props.onError(err instanceof Error ? err.message : "Card payment failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Card details</p>
      <div className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-3">
        <PaymentElement options={{ layout: "tabs" }} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={props.onBack}
          className="rounded-xl border border-zinc-700 bg-zinc-800/60 px-3 py-3 text-sm font-semibold text-zinc-200 disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={!stripe || !elements || submitting}
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 px-3 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : `Pay ${props.totalLabel}`}
        </button>
      </div>
    </form>
  )
}
