"use client"

// Public /book page — step sheets (Details → Availability or skip if ASAP → Pay/Done).
// No endless hour-slot wall: customers pick one day + From–To range, or Emergency/ASAP.

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { CustomerPortalShell } from "@/components/customer-portal-shell"
import {
  BOOK_JOB_KIND_OPTIONS,
  bookJobKindNeedsVehicle,
  buildBookDayOptions,
  buildBookTimeOptions,
  defaultBookTimeRange,
  formatBookAvailabilityLabel,
  isValidBookTimeRange,
  jobTypeFromBookFormKind,
  type BookUrgency,
} from "@/lib/book-customer-request"
import { customerPortalBookSuccessCopy } from "@/lib/customer-portal"
import { cn } from "@/lib/utils"

type AvailabilityPayload = {
  business_name: string
  line: string
  require_deposit?: boolean
  deposit_cents?: number
}

/** Wizard steps shown one at a time (sheet-style — no long scroll dump). */
type WizardStep = "details" | "availability" | "pay" | "done"

/** book = may deposit when shop requires it; callback = always soft request. */
export type BookFormMode = "book" | "callback"

const TIME_OPTIONS = buildBookTimeOptions(7, 19, 30)

const fieldClass =
  "mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"

export default function BookPageClient({
  initialLine = "",
  initialPhone = "",
  initialFormMode = "book",
}: {
  /** From /book/[id] invite resolution — used when query string is absent. */
  initialLine?: string
  initialPhone?: string
  /**
   * From invite `source`: missed-call → callback (no deposit).
   * Query `?mode=callback` also forces callback.
   */
  initialFormMode?: BookFormMode
} = {}) {
  const searchParams = useSearchParams()
  // Prefill phone from SMS link or invite.
  const phone = searchParams.get("phone")?.trim() || initialPhone.trim() || ""
  const line = searchParams.get("line")?.trim() || initialLine.trim() || ""
  const depositStatus = searchParams.get("deposit")?.trim() || ""
  const modeQs = searchParams.get("mode")?.trim().toLowerCase() || ""

  // Missed-call recovery: skip deposit; still uses ASAP / window UI.
  const isCallbackMode =
    initialFormMode === "callback" ||
    modeQs === "callback" ||
    modeQs === "missed"

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AvailabilityPayload | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(depositStatus === "success")
  /** When checkout returns a pay URL we show a brief handoff before redirect. */
  const [payHandoffUrl, setPayHandoffUrl] = useState<string | null>(null)

  // —— Step 1 fields (intake-ready) ——
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState(phone)
  const [customerEmail, setCustomerEmail] = useState("")
  const [serviceAddress, setServiceAddress] = useState("")
  const [jobKind, setJobKind] = useState("")
  const [jobOther, setJobOther] = useState("")
  const [vehicleYear, setVehicleYear] = useState("")
  const [vehicleMake, setVehicleMake] = useState("")
  const [vehicleModel, setVehicleModel] = useState("")
  const [notes, setNotes] = useState("")
  const [urgency, setUrgency] = useState<BookUrgency | null>(null)

  // —— Step 2 fields (only when urgency === "window") ——
  const dayOptions = useMemo(() => buildBookDayOptions(), [])
  const defaults = useMemo(() => defaultBookTimeRange(), [])
  const [dayKey, setDayKey] = useState(dayOptions[0]?.dateKey || "")
  const [fromTime, setFromTime] = useState(defaults.from)
  const [toTime, setToTime] = useState(defaults.to)

  // Which sheet is open (one card at a time).
  const [wizardStep, setWizardStep] = useState<WizardStep>(
    depositStatus === "success" ? "done" : "details"
  )

  useEffect(() => {
    if (phone && !customerPhone) setCustomerPhone(phone)
  }, [phone, customerPhone])

  useEffect(() => {
    if (!line) {
      setLoading(false)
      setError("This link is missing the business line. Ask us to re-send your booking text.")
      return
    }
    let cancelled = false
    setLoading(true)
    // Load business name + whether deposit is required (slots list no longer shown).
    void fetch(`/api/book/availability?line=${encodeURIComponent(line)}`)
      .then(async (res) => {
        const json = (await res.json()) as { data?: AvailabilityPayload; error?: string }
        if (!res.ok) throw new Error(json.error || res.statusText)
        if (!cancelled) setData(json.data || null)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load booking")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [line])

  // Auto-continue to Stripe when deposit checkout URL is ready.
  useEffect(() => {
    if (!payHandoffUrl) return
    setWizardStep("pay")
    const t = window.setTimeout(() => {
      window.location.href = payHandoffUrl
    }, 900)
    return () => window.clearTimeout(t)
  }, [payHandoffUrl])

  const resolvedJobType =
    jobKind === "other"
      ? jobOther.trim() || "Other"
      : jobKind
        ? jobTypeFromBookFormKind(jobKind)
        : ""

  const detailsReady =
    customerName.trim().length >= 2 &&
    customerPhone.trim().replace(/\D/g, "").length >= 10 &&
    serviceAddress.trim().length >= 5 &&
    Boolean(jobKind) &&
    (jobKind !== "other" || jobOther.trim().length >= 2) &&
    urgency != null

  const windowReady =
    Boolean(dayKey) &&
    isValidBookTimeRange(fromTime, toTime)

  const dayShort =
    dayOptions.find((d) => d.dateKey === dayKey)?.shortLabel || undefined

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

  // Deposit only for plain book invites when shop requires it AND customer picked a window.
  const mayRequireDeposit =
    !isCallbackMode && Boolean(data?.require_deposit) && urgency === "window"

  function buildPayload() {
    return {
      line,
      phone: customerPhone.trim() || phone,
      customer_name: customerName.trim(),
      email: customerEmail.trim() || undefined,
      address_line1: serviceAddress.trim(),
      job_kind: jobKind,
      job_type: resolvedJobType,
      vehicle_year: vehicleYear.trim() || undefined,
      vehicle_make: vehicleMake.trim() || undefined,
      vehicle_model: vehicleModel.trim() || undefined,
      notes: notes.trim() || undefined,
      urgency: urgency || "asap",
      is_asap: urgency === "asap",
      ...(urgency === "window"
        ? {
            availability_date: dayKey,
            availability_from: fromTime,
            availability_to: toTime,
            availability: availabilityLabel,
          }
        : {}),
    }
  }

  async function submitRequest() {
    if (!line || !detailsReady) return
    if (urgency === "window" && !windowReady) return
    setSubmitting(true)
    setError(null)
    try {
      if (mayRequireDeposit) {
        // Window + deposit shop → hold From time, then Stripe.
        const res = await fetch("/api/book/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload()),
        })
        const json = (await res.json()) as {
          data?: {
            require_deposit?: boolean
            checkout_url?: string
            status?: string
          }
          error?: string
        }
        if (!res.ok) throw new Error(json.error || res.statusText)
        if (json.data?.require_deposit && json.data.checkout_url) {
          setPayHandoffUrl(json.data.checkout_url)
          return
        }
        setSubmitted(true)
        setWizardStep("done")
        return
      }

      // ASAP, callback invites, or no-deposit shops → soft request lead.
      const res = await fetch("/api/book/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      })
      const json = (await res.json()) as { data?: { status?: string }; error?: string }
      if (!res.ok) throw new Error(json.error || res.statusText)
      setSubmitted(true)
      setWizardStep("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit your request")
    } finally {
      setSubmitting(false)
    }
  }

  function onDetailsContinue() {
    if (!detailsReady) return
    if (urgency === "asap") {
      // Emergency — skip availability sheet entirely.
      void submitRequest()
      return
    }
    setWizardStep("availability")
  }

  const depositLabel =
    data?.require_deposit && data.deposit_cents
      ? `Continue to $${(data.deposit_cents / 100).toFixed(0)} deposit`
      : "Submit request"

  const portalMode = isCallbackMode || urgency === "asap" || !mayRequireDeposit ? "callback" : "book"
  const successCopy = customerPortalBookSuccessCopy({
    mode: urgency === "asap" || isCallbackMode ? "callback" : "book",
    depositSuccess: depositStatus === "success",
    asap: urgency === "asap",
    availabilityLabel: availabilityLabel || undefined,
  })

  const subtitle =
    wizardStep === "availability"
      ? "When are you free? Pick one day and a From–To window."
      : wizardStep === "pay"
        ? "Almost done — secure deposit to hold your window."
        : wizardStep === "done"
          ? undefined
          : "Tell us what you need — we'll confirm ASAP."

  const shellStep =
    submitted || depositStatus === "success" || wizardStep === "done"
      ? "done"
      : payHandoffUrl || wizardStep === "pay"
        ? "pay"
        : "book"

  return (
    <CustomerPortalShell
      businessName={data?.business_name}
      mode={portalMode}
      currentStep={shellStep}
      subtitle={subtitle}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : error && !data ? (
        <p className="rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : payHandoffUrl || wizardStep === "pay" ? (
        <div className="rounded-2xl border border-amber-900/40 bg-amber-950/30 px-4 py-5 text-center">
          <p className="text-sm font-semibold text-amber-100">Next: secure deposit</p>
          <p className="mt-2 text-sm text-zinc-300">
            Taking you to checkout to hold your window
            {availabilityLabel ? ` (${availabilityLabel})` : ""}…
          </p>
          {payHandoffUrl ? (
            <a
              href={payHandoffUrl}
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-600 px-5 text-sm font-semibold text-white hover:bg-amber-500"
            >
              Continue to payment
            </a>
          ) : null}
        </div>
      ) : submitted || wizardStep === "done" ? (
        <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/40 px-4 py-5 text-center">
          <p className="text-base font-semibold text-emerald-100">{successCopy.title}</p>
          <p className="mt-2 text-sm text-emerald-200/90">{successCopy.body}</p>
          <p className="mt-3 text-xs text-zinc-400">{successCopy.nextHint}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Compact step chips — Details / When (only if scheduling). */}
          <div className="flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            <span
              className={cn(
                "rounded-full px-2.5 py-1",
                wizardStep === "details" && "bg-amber-500/20 text-amber-200"
              )}
            >
              1 · Details
            </span>
            {urgency === "window" || wizardStep === "availability" ? (
              <>
                <span className="text-zinc-700">→</span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1",
                    wizardStep === "availability" && "bg-amber-500/20 text-amber-200"
                  )}
                >
                  2 · When
                </span>
              </>
            ) : null}
            {mayRequireDeposit ? (
              <>
                <span className="text-zinc-700">→</span>
                <span className="rounded-full px-2.5 py-1">3 · Pay</span>
              </>
            ) : null}
          </div>

          {depositStatus === "cancelled" ? (
            <p className="rounded-lg border border-amber-900/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              Deposit checkout was cancelled — your window was not held. Submit again when ready.
            </p>
          ) : null}

          {/* —— STEP 1: Details sheet —— */}
          {wizardStep === "details" ? (
            <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 shadow-lg shadow-black/20">
              <h2 className="text-sm font-semibold text-zinc-100">Your details</h2>

              <label className="block text-sm text-zinc-300">
                Name *
                <input
                  type="text"
                  autoComplete="name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Full name"
                  className={fieldClass}
                />
              </label>

              <label className="block text-sm text-zinc-300">
                Phone *
                <input
                  type="tel"
                  autoComplete="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Mobile number"
                  className={fieldClass}
                />
              </label>

              <label className="block text-sm text-zinc-300">
                Email <span className="text-zinc-500">(optional)</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="you@email.com"
                  className={fieldClass}
                />
              </label>

              <label className="block text-sm text-zinc-300">
                Service address *
                <input
                  type="text"
                  autoComplete="street-address"
                  value={serviceAddress}
                  onChange={(e) => setServiceAddress(e.target.value)}
                  placeholder="Street, city, ZIP"
                  className={fieldClass}
                />
              </label>

              <fieldset className="space-y-2">
                <legend className="text-sm text-zinc-300">What do you need? *</legend>
                <div className="grid gap-2">
                  {BOOK_JOB_KIND_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setJobKind(opt.id)}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-left text-sm",
                        jobKind === opt.id
                          ? "border-amber-400/60 bg-amber-500/15 font-semibold text-amber-50"
                          : "border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:border-zinc-500"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {jobKind === "other" ? (
                <label className="block text-sm text-zinc-300">
                  Describe the job *
                  <input
                    type="text"
                    value={jobOther}
                    onChange={(e) => setJobOther(e.target.value)}
                    placeholder="What do you need help with?"
                    className={fieldClass}
                  />
                </label>
              ) : null}

              {bookJobKindNeedsVehicle(jobKind) ? (
                <div className="space-y-2">
                  <p className="text-sm text-zinc-300">Vehicle</p>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="block text-xs text-zinc-400">
                      Year
                      <input
                        value={vehicleYear}
                        onChange={(e) => setVehicleYear(e.target.value)}
                        inputMode="numeric"
                        placeholder="2018"
                        className={fieldClass}
                      />
                    </label>
                    <label className="block text-xs text-zinc-400">
                      Make
                      <input
                        value={vehicleMake}
                        onChange={(e) => setVehicleMake(e.target.value)}
                        placeholder="Honda"
                        className={fieldClass}
                      />
                    </label>
                    <label className="block text-xs text-zinc-400">
                      Model
                      <input
                        value={vehicleModel}
                        onChange={(e) => setVehicleModel(e.target.value)}
                        placeholder="Civic"
                        className={fieldClass}
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              <label className="block text-sm text-zinc-300">
                Notes <span className="text-zinc-500">(optional)</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Gate code, parking, key details…"
                  className={fieldClass}
                />
              </label>

              <fieldset className="space-y-2">
                <legend className="text-sm text-zinc-300">How urgent? *</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setUrgency("asap")}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left",
                      urgency === "asap"
                        ? "border-rose-400/50 bg-rose-500/15 text-rose-50"
                        : "border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:border-zinc-500"
                    )}
                  >
                    <span className="block text-sm font-semibold">Emergency / ASAP</span>
                    <span className="mt-0.5 block text-[11px] text-zinc-400">
                      Need service now — we won&apos;t ask for a time window
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrgency("window")}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left",
                      urgency === "window"
                        ? "border-amber-400/60 bg-amber-500/15 text-amber-50"
                        : "border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:border-zinc-500"
                    )}
                  >
                    <span className="block text-sm font-semibold">Schedule a window</span>
                    <span className="mt-0.5 block text-[11px] text-zinc-400">
                      Pick one day and when you&apos;re free
                    </span>
                  </button>
                </div>
              </fieldset>

              {error ? (
                <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                  {error}
                </p>
              ) : null}

              <button
                type="button"
                disabled={!detailsReady || submitting}
                onClick={() => onDetailsContinue()}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {urgency === "asap"
                  ? "Submit — need service ASAP"
                  : "Continue — pick a window"}
              </button>
              {!detailsReady ? (
                <p className="text-center text-[11px] text-zinc-500">
                  Name, phone, address, job type, and urgency are required.
                </p>
              ) : null}
            </section>
          ) : null}

          {/* —— STEP 2: Availability sheet (one day + From–To) —— */}
          {wizardStep === "availability" ? (
            <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 shadow-lg shadow-black/20">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-100">Your availability</h2>
                <button
                  type="button"
                  onClick={() => setWizardStep("details")}
                  className="text-xs font-medium text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
                >
                  Back
                </button>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm text-zinc-300">Which day?</legend>
                <div className="grid grid-cols-2 gap-2">
                  {dayOptions.map((day) => (
                    <button
                      key={day.dateKey}
                      type="button"
                      onClick={() => setDayKey(day.dateKey)}
                      className={cn(
                        "rounded-xl border px-3 py-3 text-left",
                        dayKey === day.dateKey
                          ? "border-amber-400/60 bg-amber-500/15 text-amber-50"
                          : "border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:border-zinc-500"
                      )}
                    >
                      <span className="block text-sm font-semibold">{day.shortLabel}</span>
                      <span className="mt-0.5 block text-[11px] text-zinc-400">
                        {day.label.replace(/^Today · |^Next day · /, "")}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-zinc-300">
                  From
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
                <label className="block text-sm text-zinc-300">
                  To
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
                <p className="rounded-lg border border-zinc-700/80 bg-zinc-950/50 px-3 py-2 text-center text-sm text-zinc-200">
                  You&apos;re free: <span className="font-semibold text-amber-100">{availabilityLabel}</span>
                </p>
              ) : (
                <p className="text-center text-[11px] text-rose-300/90">
                  Choose an end time after the start time.
                </p>
              )}

              {error ? (
                <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                  {error}
                </p>
              ) : null}

              <button
                type="button"
                disabled={!windowReady || submitting}
                onClick={() => void submitRequest()}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {mayRequireDeposit ? depositLabel : "Submit request"}
              </button>
            </section>
          ) : null}
        </div>
      )}
    </CustomerPortalShell>
  )
}
