"use client"

// Public booking page — slot pick (plain link) OR availability callback (missed-call).

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { SITE_NAME } from "@/lib/brand"
import type { BookableSlot } from "@/lib/book-availability"

type AvailabilityPayload = {
  business_name: string
  line: string
  slots: BookableSlot[]
  blocked_dates: string[]
  require_deposit?: boolean
  deposit_cents?: number
  fully_booked?: boolean
}

const JOB_TYPE_OPTIONS = [
  "Lockout",
  "Key replacement",
  "Keys / duplication",
  "Ignition",
  "Other",
] as const

/** book = pick an open slot; callback = free-text availability + tech follow-up. */
export type BookFormMode = "book" | "callback"

export default function BookPageClient({
  initialLine = "",
  initialPhone = "",
  initialFormMode = "book",
}: {
  /** From /book/[id] invite resolution — used when query string is absent. */
  initialLine?: string
  initialPhone?: string
  /**
   * From invite `source`: missed-call → callback form; IVR / on_call → slot book.
   * Query `?mode=callback` also forces callback (fallback links without invite rows).
   */
  initialFormMode?: BookFormMode
} = {}) {
  const searchParams = useSearchParams()
  const phone = searchParams.get("phone")?.trim() || initialPhone.trim() || ""
  const line = searchParams.get("line")?.trim() || initialLine.trim() || ""
  const depositStatus = searchParams.get("deposit")?.trim() || ""
  const modeQs = searchParams.get("mode")?.trim().toLowerCase() || ""

  // Missed-call recovery branch: collect availability, not a hard-booked slot.
  const isCallbackMode =
    initialFormMode === "callback" ||
    modeQs === "callback" ||
    modeQs === "missed"

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AvailabilityPayload | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(depositStatus === "success")

  // Required capture fields (name / address / job type).
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState(phone)
  const [serviceAddress, setServiceAddress] = useState("")
  const [jobType, setJobType] = useState<string>(JOB_TYPE_OPTIONS[0])
  const [jobTypeOther, setJobTypeOther] = useState("")
  // Free-text windows the customer is free (missed-call path only).
  const [availabilityNotes, setAvailabilityNotes] = useState("")

  useEffect(() => {
    // Keep phone field in sync if invite hydrates after first paint.
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
    // Still load business name (and slots for plain book mode).
    void fetch(`/api/book/availability?line=${encodeURIComponent(line)}`)
      .then(async (res) => {
        const json = (await res.json()) as { data?: AvailabilityPayload; error?: string }
        if (!res.ok) throw new Error(json.error || res.statusText)
        if (!cancelled) setData(json.data || null)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load availability")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [line])

  const slotsByDay = useMemo(() => {
    const map = new Map<string, BookableSlot[]>()
    for (const slot of data?.slots || []) {
      const list = map.get(slot.dateKey) || []
      list.push(slot)
      map.set(slot.dateKey, list)
    }
    return map
  }, [data])

  const resolvedJobType =
    jobType === "Other" ? jobTypeOther.trim() || "Other" : jobType

  const detailsReady =
    customerName.trim().length >= 2 &&
    serviceAddress.trim().length >= 5 &&
    resolvedJobType.length >= 2

  // Callback mode also needs phone + free-text availability.
  const callbackReady =
    detailsReady &&
    customerPhone.trim().replace(/\D/g, "").length >= 10 &&
    availabilityNotes.trim().length >= 3

  async function handleRequestSlot() {
    if (!selected || !line || !detailsReady) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/book/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line,
          phone: customerPhone.trim() || phone,
          scheduled_at: selected,
          customer_name: customerName.trim(),
          address_line1: serviceAddress.trim(),
          job_type: resolvedJobType,
        }),
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
        window.location.href = json.data.checkout_url
        return
      }
      setSubmitted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not book that time")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRequestCallback() {
    if (!line || !callbackReady) return
    setSubmitting(true)
    setError(null)
    try {
      // Creates a pending callback lead — tech follows up; no hard-booked slot.
      const res = await fetch("/api/book/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line,
          phone: customerPhone.trim(),
          customer_name: customerName.trim(),
          address_line1: serviceAddress.trim(),
          job_type: resolvedJobType,
          availability: availabilityNotes.trim(),
        }),
      })
      const json = (await res.json()) as { data?: { status?: string }; error?: string }
      if (!res.ok) throw new Error(json.error || res.statusText)
      setSubmitted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit your request")
    } finally {
      setSubmitting(false)
    }
  }

  const depositLabel =
    data?.require_deposit && data.deposit_cents
      ? `Pay $${(data.deposit_cents / 100).toFixed(0)} deposit to hold`
      : "Request this time"

  const fieldClass =
    "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-lg px-4 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90">
          {SITE_NAME}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          {data?.business_name || (isCallbackMode ? "Request a callback" : "Book a visit")}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {isCallbackMode
            ? "Sorry we missed you — share your details and when you're free. A technician will follow up ASAP."
            : "Tell us who you are and where to meet, then pick an open one-hour window."}
        </p>
        {!isCallbackMode && phone ? (
          <p className="mt-1 text-xs text-zinc-500">Booking for {phone}</p>
        ) : null}
        {depositStatus === "cancelled" && !isCallbackMode ? (
          <p className="mt-3 rounded-lg border border-amber-900/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
            Deposit checkout was cancelled — your slot was not held. Pick a time again when ready.
          </p>
        ) : null}

        {loading ? (
          <div className="mt-10 flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {isCallbackMode ? "Loading…" : "Loading open times…"}
          </div>
        ) : error && !data ? (
          <p className="mt-8 rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        ) : submitted ? (
          <p className="mt-8 rounded-xl border border-emerald-900/50 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
            {isCallbackMode
              ? "Thanks — we got your info. A technician will follow up ASAP to confirm a time."
              : depositStatus === "success"
                ? "Deposit received — your appointment slot is confirmed. We will follow up shortly."
                : "Thanks — we received your details and preferred time. A dispatcher will confirm shortly."}
          </p>
        ) : (
          <div className="mt-8 space-y-6">
            <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Your details
              </h2>
              <label className="block text-sm text-zinc-300">
                Name
                <input
                  type="text"
                  autoComplete="name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Full name"
                  className={fieldClass}
                />
              </label>
              {isCallbackMode ? (
                <label className="block text-sm text-zinc-300">
                  Phone
                  <input
                    type="tel"
                    autoComplete="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Mobile number"
                    className={fieldClass}
                  />
                </label>
              ) : null}
              <label className="block text-sm text-zinc-300">
                Service address
                <input
                  type="text"
                  autoComplete="street-address"
                  value={serviceAddress}
                  onChange={(e) => setServiceAddress(e.target.value)}
                  placeholder="Street, city, ZIP"
                  className={fieldClass}
                />
              </label>
              <label className="block text-sm text-zinc-300">
                Job type
                <select
                  value={jobType}
                  onChange={(e) => setJobType(e.target.value)}
                  className={fieldClass}
                >
                  {JOB_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
              {jobType === "Other" ? (
                <label className="block text-sm text-zinc-300">
                  Describe the job
                  <input
                    type="text"
                    value={jobTypeOther}
                    onChange={(e) => setJobTypeOther(e.target.value)}
                    placeholder="What do you need help with?"
                    className={fieldClass}
                  />
                </label>
              ) : null}
              {isCallbackMode ? (
                <label className="block text-sm text-zinc-300">
                  When are you available?
                  <textarea
                    value={availabilityNotes}
                    onChange={(e) => setAvailabilityNotes(e.target.value)}
                    placeholder="e.g. Weekdays after 3pm, or tomorrow morning"
                    rows={3}
                    className={fieldClass}
                  />
                </label>
              ) : null}
            </section>

            {/* Plain booking link only — show open slots to pick. */}
            {!isCallbackMode ? (
              slotsByDay.size === 0 ? (
                <p className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400">
                  Fully booked — no open slots in the next two weeks (calendar jobs or blockouts).
                  Please call us and we will help.
                </p>
              ) : (
                [...slotsByDay.entries()].map(([dateKey, slots]) => (
                  <section key={dateKey}>
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      {dateKey}
                    </h2>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {slots.map((slot) => {
                        const active = selected === slot.scheduledAtIso
                        return (
                          <button
                            key={slot.scheduledAtIso}
                            type="button"
                            onClick={() => setSelected(slot.scheduledAtIso)}
                            className={
                              active
                                ? "rounded-lg border border-amber-400 bg-amber-500/20 px-3 py-2 text-sm font-semibold text-amber-100"
                                : "rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-600"
                            }
                          >
                            {slot.timeValue}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))
              )
            ) : null}

            {!isCallbackMode && (data?.blocked_dates?.length || 0) > 0 ? (
              <p className="text-[11px] text-zinc-600">
                Fully booked (all-day blockouts): {data?.blocked_dates.join(", ")}
              </p>
            ) : null}

            {error ? (
              <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                {error}
              </p>
            ) : null}

            {isCallbackMode ? (
              <>
                <button
                  type="button"
                  disabled={!callbackReady || submitting}
                  onClick={() => void handleRequestCallback()}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Submit — we&apos;ll follow up ASAP
                </button>
                {!callbackReady ? (
                  <p className="text-center text-[11px] text-zinc-500">
                    Enter your name, phone, address, job type, and availability to continue.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!selected || !detailsReady || submitting}
                  onClick={() => void handleRequestSlot()}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {depositLabel}
                </button>
                {!detailsReady ? (
                  <p className="text-center text-[11px] text-zinc-500">
                    Enter your name, address, and job type to continue.
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
