"use client"

// Hold Queue Health — platform-wide answered/abandoned rates, wait times, and how often
// the Phase-1/2 smart-intake question actually produces usable data. Pairs with
// Call Health but looks at the soft-hold experience specifically.

import { useEffect, useRef, useState } from "react"
import { PhoneOff, Timer, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { usePollBudget } from "@/lib/hooks/use-poll-budget"

const POLL_MS = 60_000
const WINDOW_DAYS = 7

type HoldQueueHealthSummary = {
  window_days: number
  total_calls: number
  answered: number
  left: number
  timed_out: number
  sms_left: number
  still_open: number
  answered_rate_percent: number
  avg_wait_before_answer_secs: number | null
  avg_wait_before_leaving_secs: number | null
  intake_capture_rate_percent: number
  followup_capture_rate_percent: number
  top_abandoning_accounts: { business_name: string; abandoned: number; total: number }[]
}

function secsLabel(s: number | null): string {
  if (s == null) return "—"
  if (s < 60) return `${Math.round(s)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

/** Green above 60% answered, amber above 30%, red below — rough triage bands. */
function answeredRateTone(pct: number): string {
  if (pct >= 60) return "text-success"
  if (pct >= 30) return "text-warning"
  return "text-destructive"
}

export function HoldQueueHealthBoard() {
  const [summary, setSummary] = useState<HoldQueueHealthSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)
  const canPoll = usePollBudget()

  useEffect(() => {
    mounted.current = true
    const fetchSummary = async () => {
      try {
        const res = await fetch(`/api/admin/hold-queue-health?days=${WINDOW_DAYS}`, {
          credentials: "include",
          cache: "no-store",
        })
        const json = (await res.json().catch(() => ({}))) as { data?: HoldQueueHealthSummary }
        if (mounted.current && json?.data) setSummary(json.data)
      } catch {
        /* keep last snapshot */
      } finally {
        if (mounted.current) setLoading(false)
      }
    }
    void fetchSummary()
    if (!canPoll) return () => { mounted.current = false }
    const poll = setInterval(fetchSummary, POLL_MS)
    return () => {
      mounted.current = false
      clearInterval(poll)
    }
  }, [canPoll])

  return (
    <Card className="flex h-full flex-col border-border bg-card/60 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-foreground">
          <Timer className="h-4 w-4 text-operator" aria-hidden />
          Hold Queue Health
        </CardTitle>
        <span className="text-xs text-muted-foreground">Last {WINDOW_DAYS} days</span>
      </CardHeader>
      <CardContent className="pt-0">
        {loading && !summary ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-operator" aria-hidden /> Loading hold-queue health…
          </div>
        ) : !summary || summary.total_calls === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <PhoneOff className="h-7 w-7 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">No hold-queue calls on the network in this window.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Answered</p>
                <p className={cn("mt-1 text-xl font-semibold tabular-nums", answeredRateTone(summary.answered_rate_percent))}>
                  {summary.answered_rate_percent}%
                </p>
                <p className="text-2xs text-muted-foreground">
                  {summary.answered} / {summary.total_calls} calls
                </p>
              </div>
              <div>
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Avg wait → answer</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                  {secsLabel(summary.avg_wait_before_answer_secs)}
                </p>
                <p className="text-2xs text-muted-foreground">before an agent picked up</p>
              </div>
              <div>
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Avg wait → left</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                  {secsLabel(summary.avg_wait_before_leaving_secs)}
                </p>
                <p className="text-2xs text-muted-foreground">
                  {summary.left + summary.timed_out} abandoned
                </p>
              </div>
              <div>
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Intake captured</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                  {summary.intake_capture_rate_percent}%
                </p>
                <p className="text-2xs text-muted-foreground">
                  +{summary.followup_capture_rate_percent}% got the follow-up
                </p>
              </div>
            </div>

            {summary.top_abandoning_accounts.length > 0 ? (
              <div>
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                  Most abandoned hold sessions
                </p>
                <ul className="mt-1.5 space-y-1">
                  {summary.top_abandoning_accounts.map((row) => (
                    <li
                      key={row.business_name}
                      className="flex items-center justify-between gap-3 text-xs text-foreground"
                    >
                      <span className="truncate">{row.business_name}</span>
                      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                        {row.abandoned} / {row.total}
                      </span>
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
