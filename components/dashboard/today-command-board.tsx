"use client"

// Lines home — day board: missed callbacks, live jobs, up next, thanks + review.

import { memo, useCallback, useEffect, useState } from "react"
import {
  CheckCircle2,
  Loader2,
  MessageSquare,
  Phone,
  RefreshCw,
  Route,
  Settings2,
} from "lucide-react"
import { openSmsAutomationModal } from "@/lib/settings-modals-events"
import { CustomerSmsComposer } from "@/components/messaging/customer-sms-composer"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useToast } from "@/hooks/use-toast"
import {
  buildOnMyWayEtaSms,
  ETA_MINUTE_PRESETS,
} from "@/lib/customer-sms-presets"
import {
  LINES_MOBILE_CARD,
  LINES_MOBILE_SECTION_LABEL,
} from "@/lib/mobile-shell"
import { buildTelHref } from "@/lib/phone-e164"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { useDocumentVisible } from "@/lib/hooks/use-poll-budget"
import {
  formatTimeAgo,
  type TodayBoardPayload,
  type TodayCallbackItem,
  type TodayJobItem,
} from "@/lib/today-board"
import { cn } from "@/lib/utils"

/** Status chips shown on each “Now” job. */
const NOW_STATUS_ACTIONS: { status: string; label: string }[] = [
  { status: "en_route", label: "On the way" },
  { status: "arrived", label: "I'm here" },
  { status: "paused_wait", label: "Paused / wait" },
  { status: "paused_parts", label: "Leaving — back later" },
  { status: "completed", label: "Done" },
]

type SmsTarget = {
  phone: string
  fromLine: string | null
  variant: "missed" | "follow_up"
  title: string
}

export const TodayCommandBoard = memo(function TodayCommandBoard({
  compact = false,
}: {
  compact?: boolean
}) {
  const { toast } = useToast()
  const { activeOrganizationId } = useDashboardWorkspace()
  // Slow Today board while the browser tab is backgrounded (Lines stays mounted).
  const documentVisible = useDocumentVisible()
  const [data, setData] = useState<TodayBoardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [smsTarget, setSmsTarget] = useState<SmsTarget | null>(null)
  const [etaBusyId, setEtaBusyId] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await fetch("/api/owner/today", {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json().catch(() => null)) as {
        data?: TodayBoardPayload
        error?: string
      } | null
      if (!res.ok || !json?.data) {
        throw new Error(json?.error || "Could not load Today")
      }
      setData(json.data)
    } catch (e) {
      toast({
        title: "Today board",
        description: e instanceof Error ? e.message : "Could not load.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
    // Poll budget: full speed in foreground; 3× slower when the tab is hidden.
    const intervalMs = documentVisible ? 45_000 : 135_000
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      void load(true)
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [load, documentVisible])

  const patchStatus = useCallback(
    async (jobId: string, status: string) => {
      setBusyJobId(jobId)
      try {
        const res = await fetch(`/api/owner/jobs/${encodeURIComponent(jobId)}/status`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        })
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) {
          throw new Error(json?.error || "Could not update status")
        }
        toast({
          title: "Status updated",
          description:
            status === "completed"
              ? "Marked done."
              : status.startsWith("paused")
                ? "Customer notified."
                : "Customer will get an update if SMS is on.",
        })
        await load(true)
      } catch (e) {
        toast({
          title: "Could not update status",
          description: e instanceof Error ? e.message : "Try again.",
          variant: "destructive",
        })
      } finally {
        setBusyJobId(null)
      }
    },
    [load, toast]
  )

  const sendEta = useCallback(
    async (job: TodayJobItem, minutes: number) => {
      const phone = (job.customerPhone || "").trim()
      if (!phone) {
        toast({
          title: "No phone on file",
          description: "Add a customer phone before sending SMS.",
          variant: "destructive",
        })
        return
      }
      setEtaBusyId(job.id)
      try {
        const res = await fetch("/api/messaging/send", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: phone,
            text: buildOnMyWayEtaSms(minutes),
            organization_id:
              activeOrganizationId && !activeOrganizationId.startsWith("legacy-")
                ? activeOrganizationId
                : undefined,
          }),
        })
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) throw new Error(json?.error || "Send failed")
        toast({ title: "ETA sent", description: `Told them ~${minutes} min.` })
      } catch (e) {
        toast({
          title: "Could not send ETA",
          description: e instanceof Error ? e.message : "Try again.",
          variant: "destructive",
        })
      } finally {
        setEtaBusyId(null)
      }
    },
    [activeOrganizationId, toast]
  )

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

  const openMissedSms = (item: TodayCallbackItem) => {
    setSmsTarget({
      phone: item.callerNumber,
      fromLine: item.targetLineE164 || null,
      variant: "missed",
      title: "Text callback",
    })
  }

  const openJobSms = (job: TodayJobItem) => {
    if (!job.customerPhone?.trim()) {
      toast({
        title: "No phone on file",
        description: "This job has no customer number.",
        variant: "destructive",
      })
      return
    }
    setSmsTarget({
      phone: job.customerPhone,
      fromLine: null,
      variant: "follow_up",
      title: "Text customer",
    })
  }

  const empty =
    !loading &&
    data &&
    data.needsYou.length === 0 &&
    data.now.length === 0 &&
    data.upNext.length === 0 &&
    data.justFinished.length === 0

  return (
    <div
      className={cn(
        "w-full text-left",
        compact ? cn(LINES_MOBILE_CARD, "px-3 py-3") : "rounded-2xl border border-border/70 bg-card/80 p-4 sm:p-5"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={compact ? LINES_MOBILE_SECTION_LABEL : "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"}>
            Today
          </p>
          <p className={cn("font-semibold text-foreground", compact ? "text-sm" : "mt-0.5 text-base")}>
            Field command
          </p>
          <p className={cn("text-zinc-500", compact ? "text-xs leading-snug" : "mt-1 text-sm")}>
            Callbacks, live jobs, and one-tap customer updates.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => openSmsAutomationModal()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-2.5 text-[11px] font-semibold text-zinc-300 hover:bg-muted/40 hover:text-foreground"
            aria-label="Edit SMS templates"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Texts
          </button>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing || loading}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-zinc-400 hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
            aria-label="Refresh Today"
          >
            {refreshing || loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading today…
        </div>
      ) : empty ? (
        <p className="mt-4 text-sm text-zinc-500">Quiet day so far — no callbacks or open jobs.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {data && data.needsYou.length > 0 ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-300/90">Needs you</h3>
              <ul className="mt-2 space-y-2">
                {data.needsYou.map((item) => (
                  <CallbackRow
                    key={item.id}
                    item={item}
                    onText={() => openMissedSms(item)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {data && data.now.length > 0 ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-300/90">Now</h3>
              <ul className="mt-2 space-y-3">
                {data.now.map((job) => (
                  <NowJobCard
                    key={job.id}
                    job={job}
                    busy={busyJobId === job.id}
                    etaBusy={etaBusyId === job.id}
                    onStatus={(s) => void patchStatus(job.id, s)}
                    onText={() => openJobSms(job)}
                    onEta={(m) => void sendEta(job, m)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {data && data.upNext.length > 0 ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-teal-300/90">Up next</h3>
              <ul className="mt-2 space-y-2">
                {data.upNext.map((job) => (
                  <UpNextRow
                    key={job.id}
                    job={job}
                    busy={busyJobId === job.id}
                    onStart={() => void patchStatus(job.id, "en_route")}
                    onCall={() => {
                      const href = buildTelHref(job.customerPhone)
                      if (href) window.location.href = href
                      else {
                        toast({
                          title: "No phone on file",
                          variant: "destructive",
                        })
                      }
                    }}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {data && data.justFinished.length > 0 ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300/90">
                Just finished
              </h3>
              <ul className="mt-2 space-y-2">
                {data.justFinished.map((job) => (
                  <li
                    key={job.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/30 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {job.customerName || "Customer"}
                      </p>
                      <p className="truncate text-xs text-zinc-500">{job.location || job.summary || "Completed"}</p>
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
            </section>
          ) : null}
        </div>
      )}

      {smsTarget ? (
        <div className="mt-4 rounded-xl border border-border/70 bg-background/80 p-3">
          <CustomerSmsComposer
            toPhone={smsTarget.phone}
            fromLine={smsTarget.fromLine}
            organizationId={activeOrganizationId}
            variant={smsTarget.variant}
            title={smsTarget.title}
            showRunningLate={smsTarget.variant === "follow_up"}
            showBookingLink={smsTarget.variant === "missed"}
            onSent={() => setSmsTarget(null)}
            onClose={() => setSmsTarget(null)}
          />
        </div>
      ) : null}
    </div>
  )
})

function CallbackRow({
  item,
  onText,
}: {
  item: TodayCallbackItem
  onText: () => void
}) {
  const tel = buildTelHref(item.callerNumber)
  return (
    <li className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{item.callerName}</p>
          <p className="truncate text-xs text-zinc-400">
            {formatPhoneDisplay(item.callerNumber)} · {formatTimeAgo(item.createdAt)}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <a
          href={tel || undefined}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground",
            !tel && "pointer-events-none opacity-40"
          )}
        >
          <Phone className="h-3.5 w-3.5" />
          Call
        </a>
        <button
          type="button"
          onClick={onText}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2.5 text-xs font-semibold text-sky-200"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Text
        </button>
      </div>
    </li>
  )
}

function NowJobCard({
  job,
  busy,
  etaBusy,
  onStatus,
  onText,
  onEta,
}: {
  job: TodayJobItem
  busy: boolean
  etaBusy: boolean
  onStatus: (status: string) => void
  onText: () => void
  onEta: (minutes: number) => void
}) {
  return (
    <li className="rounded-xl border border-sky-500/25 bg-sky-500/5 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {job.customerName || "Customer"}
          </p>
          <p className="truncate text-xs text-zinc-400">{job.location || job.summary || "Job"}</p>
        </div>
        <span className="shrink-0 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
          {job.statusLabel}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {NOW_STATUS_ACTIONS.map((a) => {
          const active = (job.jobStatus || "").toLowerCase() === a.status
          return (
            <button
              key={a.status}
              type="button"
              disabled={busy || active}
              onClick={() => onStatus(a.status)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition",
                active
                  ? "bg-sky-600 text-white"
                  : "border border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:border-sky-500/40",
                (busy || active) && "opacity-60"
              )}
            >
              {a.label}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">ETA</span>
        {ETA_MINUTE_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            disabled={etaBusy || !job.customerPhone}
            onClick={() => onEta(m)}
            className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] font-semibold text-zinc-200 hover:border-sky-500/40 disabled:opacity-40"
          >
            {m}m
          </button>
        ))}
        <button
          type="button"
          onClick={onText}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-sky-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-sky-200"
        >
          <MessageSquare className="h-3 w-3" />
          Text
        </button>
      </div>
    </li>
  )
}

function UpNextRow({
  job,
  busy,
  onStart,
  onCall,
}: {
  job: TodayJobItem
  busy: boolean
  onStart: () => void
  onCall: () => void
}) {
  const when = job.scheduledAt
    ? new Date(job.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-500/20 bg-teal-500/5 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{job.customerName || "Customer"}</p>
        <p className="truncate text-xs text-zinc-500">
          {[when, job.location || job.summary].filter(Boolean).join(" · ") || "Scheduled"}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={onCall}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200"
        >
          <Phone className="h-3 w-3" />
          Call
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onStart}
          className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Route className="h-3 w-3" />}
          Start route
        </button>
      </div>
    </li>
  )
}
