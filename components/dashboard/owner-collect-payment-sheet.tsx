"use client"

// On-the-go Collect Payment — job pick OR walk-up (no job) card / Tap to Pay charge.

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { loadStripeTerminal, type Terminal } from "@stripe/terminal-js"
import { CreditCard, Loader2, MapPin, Plus, ArrowLeft, Nfc } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { DispatchJob } from "@/lib/types"
import { coerceMapCoord } from "@/lib/dispatch-map-jobs"
import { useToast } from "@/hooks/use-toast"

const TechPaymentModal = dynamic(
  () =>
    import("@/components/tech/tech-payment-modal").then((m) => ({
      default: m.TechPaymentModal,
    })),
  { ssr: false }
)

let stripePromise: Promise<Stripe | null> | null = null
function getStripePromise(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey)
  return stripePromise
}

function formatDollarsFromJob(job: DispatchJob): string | null {
  const cents = (job as DispatchJob & { quoted_price_cents?: number | null }).quoted_price_cents
  if (typeof cents === "number" && Number.isFinite(cents) && cents > 0) {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
  }
  return null
}

function jobTitle(job: DispatchJob): string {
  return (
    (job.customer_name ?? "").trim() ||
    (job.customer_phone ?? "").trim() ||
    (job.summary ?? "").trim() ||
    "Job"
  )
}

function AdhocCardForm({
  onDone,
  onCancel,
}: {
  onDone: () => void
  onCancel: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pay() {
    if (!stripe || !elements) return
    setBusy(true)
    setError(null)
    try {
      const { error: submitError } = await elements.submit()
      if (submitError) throw new Error(submitError.message || "Check card details")
      const result = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      })
      if (result.error) throw new Error(result.error.message || "Payment failed")
      const pi = result.paymentIntent
      if (pi?.id) {
        await fetch("/api/payments/confirm", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentIntentId: pi.id }),
        }).catch(() => null)
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 px-1 pb-2">
      <PaymentElement
        options={{
          // Prefer Apple Pay / Google Pay when the phone browser supports them.
          wallets: { applePay: "auto", googlePay: "auto" },
        }}
      />
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm font-semibold text-slate-300"
        >
          Back
        </button>
        <button
          type="button"
          disabled={busy || !stripe}
          onClick={() => void pay()}
          className="flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Charge card"}
        </button>
      </div>
    </div>
  )
}

export function OwnerCollectPaymentSheet({
  open,
  onOpenChange,
  onCollected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCollected?: () => void
}) {
  const { toast } = useToast()
  const [jobs, setJobs] = useState<DispatchJob[]>([])
  const [loading, setLoading] = useState(false)
  const [payJob, setPayJob] = useState<DispatchJob | null>(null)
  const [mode, setMode] = useState<"list" | "adhoc">("list")
  const [adhocAmount, setAdhocAmount] = useState("")
  const [adhocNote, setAdhocNote] = useState("")
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [taxEnabled, setTaxEnabled] = useState(false)
  const [taxRatePercent, setTaxRatePercent] = useState("6")
  const [adhocBusy, setAdhocBusy] = useState(false)
  const [tapListening, setTapListening] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [publishableKey, setPublishableKey] = useState<string | null>(null)

  const resetAdhoc = useCallback(() => {
    setMode("list")
    setAdhocAmount("")
    setAdhocNote("")
    setCustomerName("")
    setCustomerPhone("")
    setTaxEnabled(false)
    setTaxRatePercent("6")
    setClientSecret(null)
    setPublishableKey(null)
    setAdhocBusy(false)
    setTapListening(false)
  }, [])

  const loadJobs = useCallback(() => {
    setLoading(true)
    fetch("/api/owner/jobs?scope=map", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j: { data?: { jobs?: DispatchJob[] } }) => {
        const list = Array.isArray(j.data?.jobs) ? j.data!.jobs! : []
        const openJobs = list.filter((job) => {
          const s = (job.job_status ?? "").toLowerCase()
          return s !== "completed" && s !== "cancelled" && s !== "canceled"
        })
        setJobs(openJobs.length ? openJobs : list.slice(0, 12))
      })
      .catch(() => {
        setJobs([])
        toast({
          title: "Could not load jobs",
          description: "Try again in a moment.",
          variant: "destructive",
        })
      })
      .finally(() => setLoading(false))
  }, [toast])

  useEffect(() => {
    if (open) {
      loadJobs()
      resetAdhoc()
    }
  }, [open, loadJobs, resetAdhoc])

  const sorted = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const aPin = coerceMapCoord(a.latitude) != null
      const bPin = coerceMapCoord(b.latitude) != null
      if (aPin !== bPin) return aPin ? -1 : 1
      return (b.created_at || "").localeCompare(a.created_at || "")
    })
  }, [jobs])

  function parseAdhocDollars(): number | null {
    const dollars = parseFloat(adhocAmount)
    if (!Number.isFinite(dollars) || dollars < 0.5) return null
    return dollars
  }

  const adhocBreakdown = useMemo(() => {
    const subtotal = parseFloat(adhocAmount)
    const subtotalCents =
      Number.isFinite(subtotal) && subtotal > 0 ? Math.round(subtotal * 100) : 0
    const rateRaw = parseFloat(taxRatePercent)
    const rate =
      taxEnabled && Number.isFinite(rateRaw) && rateRaw > 0 ? Math.min(30, rateRaw) / 100 : 0
    const taxCents = rate > 0 ? Math.round(subtotalCents * rate) : 0
    return {
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      ratePercent: rate * 100,
    }
  }, [adhocAmount, taxEnabled, taxRatePercent])

  function fmtCents(cents: number): string {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
  }

  /** Shared body for walk-up create-intent (card or tap). */
  function adhocIntentBody(paymentMethodType: "MANUAL_CARD" | "TAP_TO_PAY") {
    const dollars = parseAdhocDollars()
    if (dollars == null) return null
    return {
      adhoc: true as const,
      amount: dollars,
      paymentMethodType,
      note: adhocNote.trim() || "Walk-up payment",
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      taxEnabled,
      taxRatePercent: taxEnabled ? parseFloat(taxRatePercent) || 0 : 0,
    }
  }

  async function startAdhocIntent() {
    const body = adhocIntentBody("MANUAL_CARD")
    if (!body) {
      toast({
        title: "Enter an amount",
        description: "Minimum is $0.50.",
        variant: "destructive",
      })
      return
    }
    setAdhocBusy(true)
    try {
      const res = await fetch("/api/payments/create-intent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { clientSecret?: string; publishableKey?: string | null }
      }
      if (!res.ok) throw new Error(json.error || "Could not start payment")
      const secret = json.data?.clientSecret
      if (!secret) throw new Error("No client_secret returned")
      setClientSecret(secret)
      setPublishableKey(json.data?.publishableKey ?? null)
    } catch (e) {
      toast({
        title: "Could not start payment",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setAdhocBusy(false)
    }
  }

  /** Customer taps card / phone on this device (Stripe Terminal / Tap to Pay). */
  async function runAdhocTapToPay() {
    const body = adhocIntentBody("TAP_TO_PAY")
    if (!body) {
      toast({
        title: "Enter an amount",
        description: "Minimum is $0.50.",
        variant: "destructive",
      })
      return
    }

    setAdhocBusy(true)
    setTapListening(true)
    let terminal: Terminal | null = null
    try {
      const res = await fetch("/api/payments/create-intent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as {
        error?: string
        data?: {
          clientSecret?: string
          paymentIntentId?: string
          publishableKey?: string | null
        }
      }
      if (!res.ok) throw new Error(json.error || "Could not start Tap to Pay")
      const secret = json.data?.clientSecret
      if (!secret) throw new Error("No client_secret returned")

      const StripeTerminal = await loadStripeTerminal()
      if (!StripeTerminal) throw new Error("Stripe Terminal SDK failed to load")

      terminal = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const tokenRes = await fetch("/api/payments/terminal/connection-token", {
            method: "POST",
            credentials: "include",
          })
          const tokenJson = (await tokenRes.json()) as {
            data?: { secret?: string }
            error?: string
          }
          if (!tokenRes.ok || !tokenJson.data?.secret) {
            throw new Error(tokenJson.error || "Could not fetch Terminal connection token")
          }
          return tokenJson.data.secret
        },
        onUnexpectedReaderDisconnect: () => {
          toast({
            title: "Reader disconnected",
            description: "Try again or use Card entry.",
            variant: "destructive",
          })
          setTapListening(false)
        },
      })

      // Real NFC/reader first; simulated reader for Stripe test mode in desktop browsers.
      let discover = await terminal.discoverReaders({ simulated: false })
      if (
        "error" in discover ||
        !("discoveredReaders" in discover) ||
        !discover.discoveredReaders?.length
      ) {
        discover = await terminal.discoverReaders({ simulated: true })
      }
      if ("error" in discover) throw new Error(discover.error.message)
      const reader = discover.discoveredReaders?.[0]
      if (!reader) {
        throw new Error(
          "No tap reader on this device. On iPhone, Tap to Pay needs the native app or Stripe Dashboard app. Use Card for now, or pair a Stripe reader."
        )
      }

      const connected = await terminal.connectReader(reader)
      if ("error" in connected) throw new Error(connected.error.message)

      const collected = await terminal.collectPaymentMethod(secret)
      if ("error" in collected) throw new Error(collected.error.message)

      const processed = await terminal.processPayment(collected.paymentIntent)
      if ("error" in processed) throw new Error(processed.error.message)

      const piId = String(processed.paymentIntent?.id || json.data?.paymentIntentId || "")
      if (piId) {
        await fetch("/api/payments/confirm", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentIntentId: piId }),
        }).catch(() => null)
      }

      resetAdhoc()
      onOpenChange(false)
      onCollected?.()
      toast({
        title: "Payment collected",
        description: "Tap to Pay succeeded — header total updated.",
      })
    } catch (e) {
      toast({
        title: "Tap to Pay failed",
        description: e instanceof Error ? e.message : "Try Card entry instead.",
        variant: "destructive",
      })
    } finally {
      setTapListening(false)
      setAdhocBusy(false)
      try {
        await terminal?.disconnectReader()
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <>
      <Sheet
        open={open && !payJob}
        onOpenChange={(next) => {
          if (!next) resetAdhoc()
          onOpenChange(next)
        }}
      >
        <SheetContent
          side="bottom"
          className="flex max-h-[88dvh] flex-col gap-0 rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg"
        >
          <SheetHeader className="shrink-0 border-b border-zinc-800 px-4 pb-3 pt-4 text-left">
            <div className="flex items-start justify-between gap-3 pr-8">
              <div>
                <SheetTitle className="text-base text-slate-100">Collect payment</SheetTitle>
                <p className="mt-0.5 text-xs text-slate-500">
                  Charge a job or start a new walk-up payment.
                </p>
              </div>
              <CreditCard className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            {mode === "list" ? (
              <>
                <button
                  type="button"
                  onClick={() => setMode("adhoc")}
                  className="mb-3 flex w-full items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-left transition-colors hover:bg-emerald-500/15"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
                    <Plus className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-emerald-100">
                      New payment (no job)
                    </span>
                    <span className="block text-xs text-emerald-200/70">
                      Walk-up — Tap to Pay or card
                    </span>
                  </span>
                </button>

                <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Or pick a job
                </p>

                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading jobs…
                  </div>
                ) : sorted.length === 0 ? (
                  <p className="px-2 py-8 text-center text-sm text-slate-500">
                    No open jobs — use New payment above.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {sorted.map((job) => {
                      const quote = formatDollarsFromJob(job)
                      return (
                        <li key={job.id}>
                          <button
                            type="button"
                            onClick={() => setPayJob(job)}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-left transition-colors",
                              "hover:border-emerald-500/40 hover:bg-zinc-900"
                            )}
                          >
                            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
                              <CreditCard className="h-4 w-4" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-slate-100">
                                {jobTitle(job)}
                              </span>
                              {job.location ? (
                                <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                                  <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                                  {job.location}
                                </span>
                              ) : null}
                              <span className="mt-1 block text-[11px] font-medium text-emerald-400/90">
                                {quote ? `Quoted ${quote}` : "Enter amount on next screen"}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={resetAdhoc}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Back to jobs
                </button>

                {!clientSecret ? (
                  <>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Customer name
                      </span>
                      <input
                        type="text"
                        autoComplete="name"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Who is paying?"
                        className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Phone (optional)
                      </span>
                      <input
                        type="tel"
                        autoComplete="tel"
                        inputMode="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="(502) 555-0100"
                        className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Amount (USD)
                      </span>
                      <div className="mt-1 flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5">
                        <span className="text-lg font-semibold text-slate-400">$</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0.50"
                          step="0.01"
                          placeholder="0.00"
                          value={adhocAmount}
                          onChange={(e) => setAdhocAmount(e.target.value)}
                          className="w-full bg-transparent text-lg font-semibold tabular-nums text-white outline-none placeholder:text-zinc-600"
                        />
                      </div>
                    </label>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-100">Sales tax</p>
                          <p className="text-[11px] text-slate-500">
                            Turn on to add tax on top of the amount
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={taxEnabled}
                          onClick={() => setTaxEnabled((v) => !v)}
                          className={cn(
                            "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                            taxEnabled ? "bg-emerald-500" : "bg-zinc-700"
                          )}
                        >
                          <span
                            className={cn(
                              "absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                              taxEnabled && "translate-x-5"
                            )}
                          />
                        </button>
                      </div>
                      {taxEnabled ? (
                        <label className="mt-3 block">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Tax rate (%)
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="30"
                            step="0.01"
                            value={taxRatePercent}
                            onChange={(e) => setTaxRatePercent(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm tabular-nums text-white outline-none"
                          />
                        </label>
                      ) : null}
                      {adhocBreakdown.subtotalCents > 0 ? (
                        <div className="mt-3 space-y-1 border-t border-zinc-800 pt-3 text-xs tabular-nums">
                          <div className="flex justify-between text-slate-400">
                            <span>Subtotal</span>
                            <span>{fmtCents(adhocBreakdown.subtotalCents)}</span>
                          </div>
                          {taxEnabled ? (
                            <div className="flex justify-between text-slate-400">
                              <span>Tax ({adhocBreakdown.ratePercent.toFixed(2)}%)</span>
                              <span>{fmtCents(adhocBreakdown.taxCents)}</span>
                            </div>
                          ) : null}
                          <div className="flex justify-between text-sm font-semibold text-emerald-300">
                            <span>Total charge</span>
                            <span>{fmtCents(adhocBreakdown.totalCents)}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Note (optional)
                      </span>
                      <input
                        type="text"
                        value={adhocNote}
                        onChange={(e) => setAdhocNote(e.target.value)}
                        placeholder="e.g. Lockout — walk-up"
                        className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600"
                      />
                    </label>

                    {tapListening ? (
                      <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-6 text-center">
                        <Nfc className="h-8 w-8 animate-pulse text-emerald-300" aria-hidden />
                        <p className="text-sm font-semibold text-emerald-100">Ready for tap</p>
                        <p className="text-xs text-emerald-200/80">
                          Hold the customer’s card or phone near this device…
                        </p>
                        <Loader2 className="mt-1 h-4 w-4 animate-spin text-emerald-300" aria-hidden />
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        <button
                          type="button"
                          disabled={adhocBusy}
                          onClick={() => void runAdhocTapToPay()}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          {adhocBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Nfc className="h-4 w-4" aria-hidden />
                          )}
                          Tap to Pay
                          {adhocBreakdown.totalCents >= 50
                            ? ` · ${fmtCents(adhocBreakdown.totalCents)}`
                            : ""}
                        </button>
                        <button
                          type="button"
                          disabled={adhocBusy}
                          onClick={() => void startAdhocIntent()}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-600 bg-zinc-900 py-3 text-sm font-semibold text-slate-100 hover:border-emerald-500/40 hover:bg-zinc-800 disabled:opacity-50"
                        >
                          <CreditCard className="h-4 w-4" aria-hidden />
                          Card / Apple Pay / Cash App
                        </button>
                        <p className="px-1 text-[11px] leading-snug text-slate-500">
                          Tap to Pay uses this phone’s NFC (or a paired Stripe reader). Safari on
                          iPhone may need the Stripe Dashboard app for phone-as-reader.
                        </p>
                      </div>
                    )}
                  </>
                ) : publishableKey ? (
                  <Elements
                    stripe={getStripePromise(publishableKey)}
                    options={{
                      clientSecret,
                      appearance: { theme: "night", variables: { colorPrimary: "#10b981" } },
                    }}
                  >
                    <AdhocCardForm
                      onCancel={resetAdhoc}
                      onDone={() => {
                        resetAdhoc()
                        onOpenChange(false)
                        onCollected?.()
                        toast({
                          title: "Payment collected",
                          description: "Walk-up charge succeeded — header total updated.",
                        })
                      }}
                    />
                  </Elements>
                ) : (
                  <p className="text-sm text-rose-400">
                    Missing Stripe publishable key. Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
                  </p>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {payJob ? (
        <TechPaymentModal
          job={payJob}
          onClose={() => setPayJob(null)}
          onCompleted={() => {
            setPayJob(null)
            onOpenChange(false)
            onCollected?.()
            toast({ title: "Payment collected", description: "Header total updated." })
          }}
        />
      ) : null}
    </>
  )
}
