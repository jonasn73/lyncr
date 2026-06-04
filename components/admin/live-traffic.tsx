"use client"

// Live Traffic Pulse — real-time feed of in-progress calls across every tenant. Polls the
// admin bridge every few seconds and renders a live per-call duration counter.

import { useEffect, useRef, useState } from "react"
import { PhoneCall, Radio, Loader2 } from "lucide-react"
import type { AdminLiveCall } from "@/lib/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const POLL_MS = 5000

/** mm:ss elapsed since an ISO timestamp, clamped at 0. */
function elapsedLabel(startedIso: string, nowMs: number): string {
  const startMs = new Date(startedIso).getTime()
  const secs = Math.max(0, Math.floor((nowMs - startMs) / 1000))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function maskNumber(raw: string): string {
  const d = raw.replace(/[^\d]/g, "")
  if (d.length < 4) return raw || "Unknown"
  return `••• ${d.slice(-4)}`
}

export function LiveTrafficPulse() {
  const [calls, setCalls] = useState<AdminLiveCall[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const fetchCalls = async () => {
      try {
        const res = await fetch("/api/admin/live-traffic", { credentials: "include", cache: "no-store" })
        const json = (await res.json().catch(() => ({}))) as { data?: { calls?: AdminLiveCall[] } }
        if (mounted.current && json?.data?.calls) setCalls(json.data.calls)
      } catch {
        /* keep last snapshot */
      } finally {
        if (mounted.current) setLoading(false)
      }
    }
    void fetchCalls()
    const poll = setInterval(fetchCalls, POLL_MS)
    // Tick the live timers once per second independent of polling.
    const tick = setInterval(() => mounted.current && setNow(Date.now()), 1000)
    return () => {
      mounted.current = false
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [])

  return (
    <Card className="flex h-full flex-col border-slate-800 bg-slate-900/60 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-slate-100">
          <span className="relative flex h-2.5 w-2.5">
            {calls.length > 0 && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={cn(
                "relative inline-flex h-2.5 w-2.5 rounded-full",
                calls.length > 0 ? "bg-emerald-400" : "bg-slate-600"
              )}
            />
          </span>
          Live Traffic Pulse
        </CardTitle>
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
          <Radio className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
          {calls.length} active {calls.length === 1 ? "call" : "calls"}
        </span>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-violet-300" aria-hidden /> Listening for live calls…
          </div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <PhoneCall className="h-7 w-7 text-slate-700" aria-hidden />
            <p className="text-sm text-slate-500">No active calls on the network right now.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {calls.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">{c.business_name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {maskNumber(c.from_number)} ·{" "}
                    {c.operator ? (
                      <span className="text-slate-400">{c.operator}</span>
                    ) : (
                      <span className="text-slate-600">Connecting…</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      c.connected
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-amber-500/15 text-amber-300"
                    )}
                  >
                    {c.connected ? "Connected" : "Ringing"}
                  </span>
                  <span className="min-w-[3rem] text-right font-mono text-sm tabular-nums text-slate-200">
                    {elapsedLabel(c.started_at, now)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
