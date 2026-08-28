"use client"

// Call Health — platform-wide missed-call rate and setup latency across every tenant,
// aggregated from data already in call_logs. Pairs with Live Traffic Pulse (in-progress
// calls) but looks backward over a rolling window instead of showing the live feed.

import { useEffect, useRef, useState } from "react"
import { PhoneMissed, Gauge, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const POLL_MS = 60_000
const WINDOW_DAYS = 7

type CallHealthSummary = {
  window_days: number
  total_calls: number
  missed_calls: number
  missed_rate_percent: number
  avg_setup_ms: number | null
  p95_setup_ms: number | null
  avg_post_dial_delay_ms: number | null
  missed_by_route: { routed_to_name: string; count: number }[]
}

function msLabel(ms: number | null): string {
  if (ms == null) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** Green under 5%, amber under 15%, red above — rough triage bands, not a contractual SLA. */
function missedRateTone(pct: number): string {
  if (pct <= 5) return "text-emerald-300"
  if (pct <= 15) return "text-amber-300"
  return "text-rose-300"
}

export function CallHealthBoard() {
  const [summary, setSummary] = useState<CallHealthSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const fetchSummary = async () => {
      try {
        const res = await fetch(`/api/admin/call-quality?days=${WINDOW_DAYS}`, {
          credentials: "include",
          cache: "no-store",
        })
        const json = (await res.json().catch(() => ({}))) as { data?: CallHealthSummary }
        if (mounted.current && json?.data) setSummary(json.data)
      } catch {
        /* keep last snapshot */
      } finally {
        if (mounted.current) setLoading(false)
      }
    }
    void fetchSummary()
    const poll = setInterval(fetchSummary, POLL_MS)
    return () => {
      mounted.current = false
      clearInterval(poll)
    }
  }, [])

  return (
    <Card className="flex h-full flex-col border-slate-800 bg-slate-900/60 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-slate-100">
          <Gauge className="h-4 w-4 text-violet-300" aria-hidden />
          Call Health
        </CardTitle>
        <span className="text-xs text-muted-foreground">Last {WINDOW_DAYS} days</span>
      </CardHeader>
      <CardContent className="pt-0">
        {loading && !summary ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-violet-300" aria-hidden /> Loading call health…
          </div>
        ) : !summary || summary.total_calls === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <PhoneMissed className="h-7 w-7 text-slate-700" aria-hidden />
            <p className="text-sm text-muted-foreground">No inbound calls on the network in this window.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Missed rate</p>
                <p className={cn("mt-1 text-xl font-semibold tabular-nums", missedRateTone(summary.missed_rate_percent))}>
                  {summary.missed_rate_percent}%
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {summary.missed_calls} / {summary.total_calls} calls
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Avg setup</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-slate-100">
                  {msLabel(summary.avg_setup_ms)}
                </p>
                <p className="text-[11px] text-muted-foreground">p95 {msLabel(summary.p95_setup_ms)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Post-dial delay</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-slate-100">
                  {msLabel(summary.avg_post_dial_delay_ms)}
                </p>
                <p className="text-[11px] text-muted-foreground">avg across window</p>
              </div>
            </div>

            {summary.missed_by_route.length > 0 ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Where missed calls landed
                </p>
                <ul className="mt-1.5 space-y-1">
                  {summary.missed_by_route.map((row) => (
                    <li
                      key={row.routed_to_name}
                      className="flex items-center justify-between gap-3 text-xs text-slate-300"
                    >
                      <span className="truncate">{row.routed_to_name}</span>
                      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{row.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
