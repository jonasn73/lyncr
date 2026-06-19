"use client"

// Global phone search in the scheduler header.

import { useEffect, useRef, useState } from "react"
import { Loader2, Phone, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SchedulerPhoneLookupResult } from "@/lib/types"

type PhoneLookupBarProps = {
  organizationId: string | null
  onResults: (result: SchedulerPhoneLookupResult | null) => void
  className?: string
}

export function PhoneLookupBar({ organizationId, onResults, className }: PhoneLookupBarProps) {
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const digits = query.replace(/\D/g, "")
    if (digits.length < 7) {
      onResults(null)
      return
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      const orgQuery = organizationId ? `&organization_id=${encodeURIComponent(organizationId)}` : ""
      void fetch(`/api/owner/scheduler/lookup?phone=${encodeURIComponent(query)}${orgQuery}`, {
        credentials: "include",
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("lookup"))))
        .then((j: { data?: SchedulerPhoneLookupResult }) => onResults(j.data ?? { pool: [], scheduled: [] }))
        .catch(() => onResults({ pool: [], scheduled: [] }))
        .finally(() => setLoading(false))
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, organizationId, onResults])

  return (
    <div className={cn("relative w-full max-w-xs sm:max-w-sm", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
      <input
        type="tel"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by phone…"
        className="w-full rounded-xl border border-border/70 bg-background py-2 pl-9 pr-9 text-sm text-foreground placeholder:text-zinc-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {loading ? (
        <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-500" />
      ) : query ? (
        <button
          type="button"
          aria-label="Clear phone search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-500 hover:bg-muted hover:text-foreground"
          onClick={() => setQuery("")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Phone className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
      )}
    </div>
  )
}
