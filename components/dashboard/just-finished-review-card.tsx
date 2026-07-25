"use client"

// Slim Lines card: today’s completed jobs → one-tap Thanks + review (no full Field command board).

import { memo, useCallback, useEffect, useState } from "react"
import { CheckCircle2, Loader2, Settings2 } from "lucide-react"
import { openSmsAutomationModal } from "@/lib/settings-modals-events"
import { useToast } from "@/hooks/use-toast"
import {
  LINES_MOBILE_CARD,
  LINES_MOBILE_SECTION_LABEL,
} from "@/lib/mobile-shell"
import type { TodayBoardPayload, TodayJobItem } from "@/lib/today-board"
import { cn } from "@/lib/utils"

export const JustFinishedReviewCard = memo(function JustFinishedReviewCard({
  compact = false,
}: {
  compact?: boolean
}) {
  const { toast } = useToast()
  const [jobs, setJobs] = useState<TodayJobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/owner/today", {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json().catch(() => null)) as {
        data?: TodayBoardPayload
        error?: string
      } | null
      if (!res.ok || !json?.data) return
      setJobs(json.data.justFinished ?? [])
    } catch {
      /* keep last */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(id)
  }, [load])

  const sendThanksReview = useCallback(
    async (jobId: string) => {
      setBusyJobId(jobId)
      try {
        const res = await fetch(
          `/api/owner/jobs/${encodeURIComponent(jobId)}/thanks-review`,
          { method: "POST", credentials: "include" }
        )
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) throw new Error(json?.error || "Could not send review SMS")
        toast({
          title: "Thanks + review sent",
          description: "Customer got your thank-you text.",
        })
      } catch (e) {
        toast({
          title: "Could not send thanks",
          description: e instanceof Error ? e.message : "Try again in a moment.",
          variant: "destructive",
        })
      } finally {
        setBusyJobId(null)
      }
    },
    [toast]
  )

  // Hide the whole card when there’s nothing finished today (after first load).
  if (!loading && jobs.length === 0) return null

  return (
    <div
      className={cn(
        "w-full text-left",
        compact ? cn(LINES_MOBILE_CARD, "px-3 py-3") : "rounded-2xl border border-border/70 bg-card/80 p-4 sm:p-5"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={
              compact
                ? LINES_MOBILE_SECTION_LABEL
                : "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
            }
          >
            Just finished
          </p>
          <p className={cn("font-semibold text-foreground", compact ? "text-sm" : "mt-0.5 text-base")}>
            Thanks + review
          </p>
          <p className={cn("text-zinc-500", compact ? "text-xs leading-snug" : "mt-1 text-sm")}>
            Send your thank-you / review text after a job.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openSmsAutomationModal()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-2.5 text-[11px] font-semibold text-zinc-300 hover:bg-muted/40 hover:text-foreground"
          aria-label="Edit SMS templates"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Texts
        </button>
      </div>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {job.customerName || "Customer"}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {job.location || job.summary || "Completed"}
                </p>
              </div>
              <button
                type="button"
                disabled={busyJobId === job.id}
                onClick={() => void sendThanksReview(job.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/90 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busyJobId === job.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                Thanks + review
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
