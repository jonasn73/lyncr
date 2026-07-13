"use client"

// Action sheet: today's missed callers with a primary Call Back & Rescue CTA.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Phone, PhoneMissed } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { businessNumbersMatch, formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { isMissedCallRecord, isMissedCallTodayRecord } from "@/lib/missed-call-telemetry"
import { buildTelHref } from "@/lib/phone-e164"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import { activityCallerPhoneKey } from "@/lib/activity-call-groups"

type MissedCallRow = {
  id: string
  call_type: string
  from_number: string
  to_number: string
  created_at: string
  status: string
  answered_at?: string | null
  ended_at?: string | null
  routed_to_name?: string | null
}

export type MissedHotlistItem = {
  key: string
  from_number: string
  count: number
  /** Most recent missed call ISO timestamp for this number today. */
  latestAt: string
  /** All missed times today, newest first (local clock strings). */
  times: string[]
}

function formatMissedTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

/**
 * Group ALL of today's missed rows by caller (not just consecutive).
 * Latest timestamp wins the header clock; times[] keeps every occurrence (newest first).
 */
export function collapseMissedHotlist(rows: MissedCallRow[]): MissedHotlistItem[] {
  const byKey = new Map<
    string,
    { key: string; from_number: string; count: number; stamps: string[] }
  >()

  for (const row of rows) {
    const key = activityCallerPhoneKey(row.from_number) || row.from_number.replace(/\D/g, "") || "unknown"
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        key,
        from_number: row.from_number,
        count: 1,
        stamps: [row.created_at],
      })
      continue
    }
    existing.count += 1
    existing.stamps.push(row.created_at)
  }

  const items: MissedHotlistItem[] = []
  for (const g of byKey.values()) {
    const stamps = [...g.stamps].sort((a, b) => Date.parse(b) - Date.parse(a))
    const latestAt = stamps[0] || ""
    const seen = new Set<string>()
    const times: string[] = []
    for (const iso of stamps) {
      const label = formatMissedTime(iso)
      if (!label || seen.has(label)) continue
      seen.add(label)
      times.push(label)
    }
    items.push({
      key: g.key,
      from_number: g.from_number,
      count: g.count,
      latestAt,
      times,
    })
  }

  items.sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt))
  return items
}

export function MissedCallRescueSheet({
  open,
  onOpenChange,
  businessNumbers,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  businessNumbers: DashboardBusinessNumber[]
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<MissedCallRow[]>([])
  const [fetchedAt, setFetchedAt] = useState(0)

  const loadMissed = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Bust caches so the sheet always shows the latest missed activity.
      const res = await fetch(`/api/calls?limit=100&_=${Date.now()}`, {
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      })
      if (!res.ok) throw new Error("Could not load missed calls")
      const json = (await res.json()) as { calls?: MissedCallRow[]; data?: MissedCallRow[] }
      const all = Array.isArray(json.calls)
        ? json.calls
        : Array.isArray(json.data)
          ? json.data
          : []
      const missed = all
        .filter((row) => {
          if (businessNumbers.length > 0) {
            const onLine = businessNumbers.some((line) =>
              businessNumbersMatch(row.to_number, line.number)
            )
            if (!onLine) return false
          }
          return isMissedCallTodayRecord({
            call_type: row.call_type,
            status: row.status,
            answered_at: row.answered_at,
            ended_at: row.ended_at,
            routed_to_name: row.routed_to_name ?? null,
            created_at: row.created_at,
          })
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setRows(missed)
      setFetchedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load missed calls")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [businessNumbers])

  useEffect(() => {
    if (!open) return
    // Clear stale rows immediately so old timestamps do not flash while refetching.
    setRows([])
    void loadMissed()
  }, [open, loadMissed])

  const hotlist = useMemo(() => collapseMissedHotlist(rows), [rows])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        variant="drawer"
        className="flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl border-slate-850 bg-slate-950 p-0"
      >
        <SheetHeader className="shrink-0 border-b border-slate-850 px-4 pb-3 pt-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base text-slate-100">
            <PhoneMissed className="h-4 w-4 text-amber-300" aria-hidden />
            Missed call rescue
          </SheetTitle>
          {/* Non-actionable copy — hide on the smallest phones per global UI standards. */}
          <SheetDescription className="hidden text-xs text-slate-500 md:block">
            Today&apos;s missed numbers — tap Call Back &amp; Rescue to reclaim the lead.
          </SheetDescription>
        </SheetHeader>

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-4 py-3",
            "pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
          )}
        >
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading hotlist…
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-400">{error}</p>
          ) : hotlist.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No missed calls today — nice work.</p>
          ) : (
            <ul className="flex flex-col gap-2" data-fetched-at={fetchedAt || undefined}>
              {hotlist.map((item) => {
                const href = buildTelHref(item.from_number)
                const phoneLabel = formatPhoneDisplay(item.from_number) || "Unknown Caller"
                const label =
                  item.count > 1 ? `${phoneLabel} (x${item.count})` : phoneLabel
                return (
                  <li
                    key={item.key}
                    className="rounded-xl border border-slate-850 bg-slate-900/40 p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-100">{label}</p>
                      <span className="shrink-0 text-[10px] font-semibold tabular-nums text-amber-200/90">
                        {formatMissedTime(item.latestAt)}
                      </span>
                    </div>
                    {href ? (
                      <a
                        href={href}
                        className={cn(
                          "mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl",
                          "border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5",
                          "text-sm font-semibold text-emerald-200 transition-all",
                          "hover:bg-emerald-500/25 active:scale-95",
                          MOBILE_TAP_TARGET
                        )}
                      >
                        <Phone className="h-4 w-4 shrink-0" aria-hidden />
                        Call Back &amp; Rescue
                      </a>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">No dialable number on this log.</p>
                    )}
                    {item.count > 1 && item.times.length > 0 ? (
                      <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-medium leading-snug text-amber-100/90">
                        Called today at {item.times.join(" · ")}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Re-export helper for tests / telemetry filtering. */
export function isMissedHotlistRow(row: MissedCallRow): boolean {
  return isMissedCallRecord({
    call_type: row.call_type,
    status: row.status,
    answered_at: row.answered_at,
    ended_at: row.ended_at,
    routed_to_name: row.routed_to_name ?? null,
  })
}
