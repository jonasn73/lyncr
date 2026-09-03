// Tech console — Performance tab: earned/locked achievement badges, in the "Field Notebook"
// card language (rounded-2xl, warm purple tint when earned) that replaced the vintage badge grid.

"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import type { TechBadge } from "@/lib/tech-badges"

export function TechPerformance() {
  const [badges, setBadges] = useState<TechBadge[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch("/api/tech/jobs", { credentials: "include", cache: "no-store" })
        const json = await res.json()
        if (!cancelled && json?.data?.badges) setBadges(json.data.badges as TechBadge[])
      } catch {
        /* keep empty on transient error */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin" />
        <p className="mt-3 text-sm">Loading your badges…</p>
      </div>
    )
  }

  const earnedCount = badges.filter((b) => b.earned).length

  return (
    <section>
      <p className="mb-4 text-2xs font-medium text-muted-foreground">
        {earnedCount}/{badges.length} earned
      </p>
      <div className="grid grid-cols-2 gap-3">
        {badges.map((b) => (
          <div
            key={b.id}
            className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-5 text-center transition ${
              b.earned ? "border-operator/40 bg-operator/10" : "border-border bg-card/50 opacity-60 grayscale"
            }`}
          >
            <span className="text-3xl leading-none" aria-hidden>
              {b.emoji}
            </span>
            <span className="text-sm font-semibold leading-tight font-[family-name:var(--font-tech-heading)]">
              {b.label}
            </span>
            <span className="text-2xs leading-snug text-muted-foreground">{b.description}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
