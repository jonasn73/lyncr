"use client"

// Customer form before $49 service-call payment — name, phone, address, YMM, copy vs AKL.

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { SERVICE_CALL_FEE_DOLLARS } from "@/lib/service-call-fee"

type Prefill = {
  customer_name: string
  phone: string
  address: string
  vehicle_year: string
  vehicle_make: string
  vehicle_model: string
  job_kind: string
  notes: string
}

const JOB_KIND_OPTIONS = [
  { id: "copy", label: "Need a key copy (have a working key)" },
  { id: "akl", label: "All keys lost (AKL)" },
  { id: "lockout", label: "Vehicle lockout" },
  { id: "other", label: "Other" },
] as const

export function ServiceCallFormClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Opaque token from the SMS link (?p=…)
  const token = (searchParams.get("p") || "").trim()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [businessLabel, setBusinessLabel] = useState("Your locksmith")
  const [amountDollars, setAmountDollars] = useState(SERVICE_CALL_FEE_DOLLARS)

  const [customerName, setCustomerName] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [year, setYear] = useState("")
  const [make, setMake] = useState("")
  const [model, setModel] = useState("")
  const [jobKind, setJobKind] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (!token) {
      setError("This link is missing or incomplete. Ask the shop to text you a new one.")
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/pay/service-call?p=${encodeURIComponent(token)}`)
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          data?: {
            business_label?: string
            amount_dollars?: number
            prefill?: Prefill
          }
        }
        if (!res.ok) throw new Error(json.error || "Could not open this link")
        if (cancelled) return
        setBusinessLabel(json.data?.business_label || "Your locksmith")
        setAmountDollars(json.data?.amount_dollars || SERVICE_CALL_FEE_DOLLARS)
        const p = json.data?.prefill
        if (p) {
          setCustomerName(p.customer_name || "")
          setPhone(p.phone || "")
          setAddress(p.address || "")
          setYear(p.vehicle_year || "")
          setMake(p.vehicle_make || "")
          setModel(p.vehicle_model || "")
          setJobKind(p.job_kind || "")
          setNotes(p.notes || "")
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not open this link")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/pay/service-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p: token,
          customer_name: customerName,
          phone,
          address,
          vehicle_year: year,
          vehicle_make: make,
          vehicle_model: model,
          job_kind: jobKind,
          notes,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { pay_url?: string }
      }
      if (!res.ok) throw new Error(json.error || "Could not save your info")
      if (!json.data?.pay_url) throw new Error("Payment page missing — ask the shop for a new link")
      // Form saved → Stripe checkout on the branded pay page
      router.push(`/pay/${token}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
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

  if (error && !customerName && !phone && !token) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <p className="text-lg font-semibold text-white">Link problem</p>
        <p className="mt-2 text-sm text-slate-400">{error}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
        {businessLabel}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
        Service call — ${amountDollars}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        Fill this in so a technician can be on the way. Then pay the ${amountDollars} service call
        fee securely.
      </p>

      <form onSubmit={(e) => void onSubmit(e)} className="mt-6 space-y-4">
        <label className="block space-y-2">
          <span className="text-xs font-medium text-slate-300">Your name *</span>
          <input
            required
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500/60"
            autoComplete="name"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-medium text-slate-300">Phone *</span>
          <input
            required
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500/60"
            autoComplete="tel"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-medium text-slate-300">Service address *</span>
          <input
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street, city, ZIP"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500/60"
            autoComplete="street-address"
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="block space-y-2">
            <span className="text-xs font-medium text-slate-300">Year</span>
            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-3 text-sm text-white outline-none focus:border-emerald-500/60"
            />
          </label>
          <label className="col-span-1 block space-y-2">
            <span className="text-xs font-medium text-slate-300">Make</span>
            <input
              value={make}
              onChange={(e) => setMake(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-3 text-sm text-white outline-none focus:border-emerald-500/60"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-medium text-slate-300">Model</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-3 text-sm text-white outline-none focus:border-emerald-500/60"
            />
          </label>
        </div>

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
                    ? "rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-3 text-left text-sm font-medium text-emerald-50"
                    : "rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-left text-sm text-slate-200"
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block space-y-2">
          <span className="text-xs font-medium text-slate-300">Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500/60"
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
          Continue to pay ${amountDollars}
        </button>
      </form>
    </div>
  )
}
