"use client"

// Public booking page — shows open 1-hour slots (jobs + blockouts filtered).

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
}

export default function BookPageClient() {
  const searchParams = useSearchParams()
  const phone = searchParams.get("phone")?.trim() || ""
  const line = searchParams.get("line")?.trim() || ""

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AvailabilityPayload | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!line) {
      setLoading(false)
      setError("This link is missing the business line. Ask us to re-send your booking text.")
      return
    }
    let cancelled = false
    setLoading(true)
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

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-lg px-4 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90">
          {SITE_NAME}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          {data?.business_name || "Book a visit"}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Pick an open one-hour window. Days fully blocked by the business stay hidden as
          unavailable.
        </p>
        {phone ? (
          <p className="mt-1 text-xs text-zinc-500">Booking for {phone}</p>
        ) : null}

        {loading ? (
          <div className="mt-10 flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading open times…
          </div>
        ) : error ? (
          <p className="mt-8 rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        ) : submitted ? (
          <p className="mt-8 rounded-xl border border-emerald-900/50 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
            Thanks — we received your preferred time. A dispatcher will confirm shortly.
          </p>
        ) : (
          <div className="mt-8 space-y-6">
            {slotsByDay.size === 0 ? (
              <p className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400">
                No open slots in the next two weeks. Please call us and we will help.
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
            )}

            {(data?.blocked_dates?.length || 0) > 0 ? (
              <p className="text-[11px] text-zinc-600">
                Fully unavailable: {data?.blocked_dates.join(", ")}
              </p>
            ) : null}

            <button
              type="button"
              disabled={!selected}
              onClick={() => setSubmitted(true)}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-amber-600 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Request this time
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
