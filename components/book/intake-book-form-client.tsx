"use client"

// Customer Activity book-link form — step sheets + (when paid) Embedded Checkout.
// Same ASAP / window model as /book/[id] so owner intake gets consistent fields.

import { useCallback, useEffect, useMemo, useState } from "react"
import { loadStripe } from "@stripe/stripe-js"
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js"
import { Loader2 } from "lucide-react"
import {
  BOOK_JOB_KIND_OPTIONS,
  bookJobKindNeedsVehicle,
  buildBookDayOptions,
  buildBookTimeOptions,
  defaultBookTimeRange,
  formatBookAvailabilityLabel,
  isValidBookTimeRange,
  type BookUrgency,
} from "@/lib/book-customer-request"
import { customerPortalBookSuccessCopy } from "@/lib/customer-portal"
import { cn } from "@/lib/utils"

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

type WizardStep = "details" | "availability" | "pay" | "done"

const TIME_OPTIONS = buildBookTimeOptions(7, 19, 30)

const fieldClass =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/60"

export function IntakeBookFormClient({ inviteId }: { inviteId: string }) {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState<InvitePayload | null>(null)
  const [wizardStep, setWizardStep] = useState<WizardStep>("details")

  // After form save — show Embedded Checkout on this same screen
  const [payClientSecret, setPayClientSecret] = useState<string | null>(null)
  const [payPublishableKey, setPayPublishableKey] = useState<string | null>(null)
  const [payStripeAccount, setPayStripeAccount] = useState<string | null>(null)

  const [customerName, setCustomerName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [address, setAddress] = useState("")
  const [year, setYear] = useState("")
  const [make, setMake] = useState("")
  const [model, setModel] = useState("")
  const [vehicleText, setVehicleText] = useState("")
  const [jobKind, setJobKind] = useState("")
  const [notes, setNotes] = useState("")
  /** Notes stay collapsed until the customer taps “Add notes”. */
  const [notesOpen, setNotesOpen] = useState(false)
  /** Optional email stays collapsed until tapped. */
  const [emailOpen, setEmailOpen] = useState(false)
  const [urgency, setUrgency] = useState<BookUrgency | null>(null)

  const dayOptions = useMemo(() => buildBookDayOptions(), [])
  const defaults = useMemo(() => defaultBookTimeRange(), [])
  const [dayKey, setDayKey] = useState(dayOptions[0]?.dateKey || "")
  const [fromTime, setFromTime] = useState(defaults.from)
  const [toTime, setToTime] = useState(defaults.to)

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
      setWizardStep("done")
      return
    }
    if (!json.data.client_secret || !json.data.publishable_key) {
      throw new Error("Payment page missing — ask the shop for a new link")
    }
    setPayClientSecret(json.data.client_secret)
    setPayPublishableKey(json.data.publishable_key)
    setPayStripeAccount(json.data.stripe_account_id ?? null)
  }, [])

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
          setWizardStep("done")
        } else if (json.data.already_submitted && json.data.requires_payment && json.data.pay_token) {
          // Resume pay if they already submitted details.
          await loadCheckout(json.data.pay_token)
          setWizardStep("pay")
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per invite
  }, [inviteId])

  const stripePromise = useMemo(() => {
    if (!payPublishableKey) return null
    const acct = payStripeAccount?.trim()
    return loadStripe(payPublishableKey, acct ? { stripeAccount: acct } : undefined)
  }, [payPublishableKey, payStripeAccount])


  const detailsReady =
    customerName.trim().length >= 2 &&
    phone.trim().replace(/\D/g, "").length >= 10 &&
    address.trim().length >= 5 &&
    Boolean(jobKind) &&
    urgency != null

  const windowReady = Boolean(dayKey) && isValidBookTimeRange(fromTime, toTime)
  const dayShort = dayOptions.find((d) => d.dateKey === dayKey)?.shortLabel
  const availabilityLabel =
    urgency === "window" && windowReady
      ? formatBookAvailabilityLabel({
          dateKey: dayKey,
          fromHhmm: fromTime,
          toHhmm: toTime,
          dayShortLabel: dayShort,
        })
      : urgency === "asap"
        ? "ASAP / emergency"
        : ""

  async function submitForm() {
    if (!invite || submitting || !detailsReady) return
    if (urgency === "window" && !windowReady) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/book/form/${encodeURIComponent(inviteId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName,
          phone,
          email: email.trim() || undefined,
          address,
          vehicle_year: year,
          vehicle_make: make,
          vehicle_model: model,
          vehicle_text: vehicleText,
          job_kind: jobKind,
          notes,
          urgency,
          is_asap: urgency === "asap",
          ...(urgency === "window"
            ? {
                availability_date: dayKey,
                availability_from: fromTime,
                availability_to: toTime,
                availability: availabilityLabel,
              }
            : {}),
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
        await loadCheckout(json.data.pay_token)
        setWizardStep("pay")
      } else {
        setWizardStep("done")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  function onDetailsContinue() {
    if (!detailsReady) return
    if (urgency === "asap") {
      void submitForm()
      return
    }
    setWizardStep("availability")
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
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
      </div>
    )
  }

  if (wizardStep === "done") {
    // Same thank-you promise as /book portal (ASAP vs window).
    const successCopy = customerPortalBookSuccessCopy({
      mode: "callback",
      asap: urgency === "asap",
      availabilityLabel: urgency === "window" ? availabilityLabel : undefined,
    })
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center pb-[calc(env(safe-area-inset-bottom)+2rem)]">
        <p className="text-2xl font-semibold text-white">{successCopy.title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{successCopy.body}</p>
        <p className="mt-3 text-xs text-muted-foreground">{successCopy.nextHint}</p>
        {invite?.business_label ? (
          <p className="mt-4 text-[11px] text-muted-foreground">{invite.business_label}</p>
        ) : null}
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
          : wizardStep === "pay"
            ? `Pay ${amountLabel}`
            : `Book & pay ${amountLabel}`}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {wizardStep === "availability"
          ? "Pick one day and when you’re free (start–end)."
          : wizardStep === "pay"
            ? `Pay ${amountLabel} with Cash App, Apple Pay, card, or Link.`
            : invite?.fee_mode === "none"
              ? "Quick details so we can help — then confirm urgency."
              : `Fill this in, then pay ${amountLabel} on the next step.`}
      </p>
      {invite?.operator_note ? (
        <p className="mt-3 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-300">
          {invite.operator_note}
        </p>
      ) : null}

      {/* Step chips */}
      {wizardStep !== "pay" ? (
        <div className="mt-5 flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span
            className={cn(
              "rounded-full px-3 py-1",
              wizardStep === "details" && "bg-emerald-500/20 text-emerald-200"
            )}
          >
            1 · Details
          </span>
          {urgency === "window" || wizardStep === "availability" ? (
            <>
              <span className="text-slate-700">→</span>
              <span
                className={cn(
                  "rounded-full px-3 py-1",
                  wizardStep === "availability" && "bg-emerald-500/20 text-emerald-200"
                )}
              >
                2 · When
              </span>
            </>
          ) : null}
          {invite?.fee_mode !== "none" ? (
            <>
              <span className="text-slate-700">→</span>
              <span className="rounded-full px-3 py-1">3 · Pay</span>
            </>
          ) : null}
        </div>
      ) : null}

      {wizardStep === "details" ? (
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:p-4">
          <div className="space-y-3">
            {/* Name + phone on one row */}
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-0.5">
                <span className="text-xs font-medium text-muted-foreground">Name *</span>
                <input
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className={fieldClass}
                  autoComplete="name"
                />
              </label>
              <label className="block space-y-0.5">
                <span className="text-xs font-medium text-muted-foreground">Phone *</span>
                <input
                  required
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={fieldClass}
                  autoComplete="tel"
                />
              </label>
            </div>

            <label className="block space-y-0.5">
              <span className="text-xs font-medium text-muted-foreground">Address *</span>
              <input
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street, city, ZIP"
                className={fieldClass}
                autoComplete="street-address"
              />
            </label>

            {emailOpen || email ? (
              <label className="block space-y-0.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Email <span className="text-muted-foreground">(optional)</span>
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldClass}
                  autoComplete="email"
                />
              </label>
            ) : (
              <button
                type="button"
                onClick={() => setEmailOpen(true)}
                className="text-left text-xs font-medium text-muted-foreground underline-offset-2 hover:text-slate-300 hover:underline"
              >
                + Add email
              </button>
            )}

            <fieldset>
              <legend className="mb-1 text-xs font-medium text-muted-foreground">Job type *</legend>
              <div className="grid grid-cols-2 gap-2">
                {BOOK_JOB_KIND_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    title={opt.label}
                    onClick={() => setJobKind(opt.id)}
                    className={
                      jobKind === opt.id
                        ? "rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-2 py-2 text-center text-xs font-medium text-emerald-50"
                        : "rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-center text-xs text-slate-200"
                    }
                  >
                    {opt.chip}
                  </button>
                ))}
              </div>
            </fieldset>

            {bookJobKindNeedsVehicle(jobKind) ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Vehicle</p>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block space-y-0.5">
                    <span className="text-[10px] text-muted-foreground">Year</span>
                    <input
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      inputMode="numeric"
                      className={fieldClass}
                    />
                  </label>
                  <label className="block space-y-0.5">
                    <span className="text-[10px] text-muted-foreground">Make</span>
                    <input
                      value={make}
                      onChange={(e) => setMake(e.target.value)}
                      className={fieldClass}
                    />
                  </label>
                  <label className="block space-y-0.5">
                    <span className="text-[10px] text-muted-foreground">Model</span>
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className={fieldClass}
                    />
                  </label>
                </div>
                <label className="mt-1.5 block space-y-0.5">
                  <span className="text-[10px] text-muted-foreground">Or describe</span>
                  <input
                    value={vehicleText}
                    onChange={(e) => setVehicleText(e.target.value)}
                    placeholder="e.g. Silver Honda Civic"
                    className={fieldClass}
                  />
                </label>
              </div>
            ) : null}

            {notesOpen || notes ? (
              <label className="block space-y-0.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Notes <span className="text-muted-foreground">(optional)</span>
                </span>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={fieldClass}
                  placeholder="Gate code, parking…"
                />
              </label>
            ) : (
              <button
                type="button"
                onClick={() => setNotesOpen(true)}
                className="text-left text-xs font-medium text-muted-foreground underline-offset-2 hover:text-slate-300 hover:underline"
              >
                + Add notes
              </button>
            )}

            <fieldset>
              <legend className="mb-1 text-xs font-medium text-muted-foreground">Urgency *</legend>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setUrgency("asap")}
                  className={
                    urgency === "asap"
                      ? "rounded-lg border border-rose-500/40 bg-rose-500/15 px-2 py-2 text-center text-xs text-rose-50"
                      : "rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-center text-xs text-slate-200"
                  }
                >
                  <span className="font-semibold">ASAP</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">Need help now</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUrgency("window")}
                  className={
                    urgency === "window"
                      ? "rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-2 py-2 text-center text-xs text-emerald-50"
                      : "rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-center text-xs text-slate-200"
                  }
                >
                  <span className="font-semibold">Schedule</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">Pick a window</span>
                </button>
              </div>
            </fieldset>

            {error ? <p className="text-sm text-red-300">{error}</p> : null}
          </div>

          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800/80 bg-slate-950/95 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-sm">
            <div className="mx-auto w-full max-w-lg">
              <button
                type="button"
                disabled={!detailsReady || submitting}
                onClick={() => onDetailsContinue()}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {urgency === "asap"
                  ? invite?.fee_mode === "none"
                    ? "Submit — need service ASAP"
                    : `Submit ASAP · then pay ${amountLabel}`
                  : "Continue — pick a window"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {wizardStep === "availability" ? (
        <div className="mt-6 space-y-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Your availability</p>
            <button
              type="button"
              onClick={() => setWizardStep("details")}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Back
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {dayOptions.map((day) => (
              <button
                key={day.dateKey}
                type="button"
                onClick={() => setDayKey(day.dateKey)}
                className={
                  dayKey === day.dateKey
                    ? "rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-3 text-left text-sm text-emerald-50"
                    : "rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-left text-sm text-slate-200"
                }
              >
                <span className="font-semibold">{day.shortLabel}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-2">
              <span className="text-xs font-medium text-slate-300">From</span>
              <select
                value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
                className={fieldClass}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-medium text-slate-300">To</span>
              <select
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
                className={fieldClass}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {windowReady ? (
            <p className="text-center text-sm text-slate-200">
              Free: <span className="font-semibold text-emerald-200">{availabilityLabel}</span>
            </p>
          ) : (
            <p className="text-center text-[11px] text-rose-300">End time must be after start.</p>
          )}

          {error ? <p className="text-sm text-red-300">{error}</p> : null}

          <button
            type="button"
            disabled={!windowReady || submitting}
            onClick={() => void submitForm()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-base font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {invite?.fee_mode === "none" ? "Submit" : `Continue to pay ${amountLabel}`}
          </button>
        </div>
      ) : null}

      {wizardStep === "pay" && payClientSecret && stripePromise ? (
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
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            On iPhone Safari, Apple Pay shows when available. Cash App and cards work on any device.
          </p>
        </div>
      ) : null}
    </div>
  )
}
