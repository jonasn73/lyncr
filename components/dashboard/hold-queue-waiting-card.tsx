"use client"

// Lines — Hold queue waiting list + Answer (Busy stay-on-the-line callers).

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { PhoneIncoming } from "lucide-react"
import { cn } from "@/lib/utils"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { useDashboardSessionOptional } from "@/components/dashboard-session-context"
import { useInboundCallPanelOptional } from "@/lib/inbound-call-panel-context"
import { SendBookLinkButton } from "@/components/activity/send-book-link-sheet"
import { busyMenuAnswerUnlockMs, isHoldQueueAnswerable } from "@/lib/hold-queue"

type QueueCaller = {
  id: string
  callControlId: string
  callerE164: string | null
  businessLineE164: string | null
  status: string
  enqueuedAt: string
  queueName: string
}

/** Light hold-queue rollup for Lines (today). */
type QueueStats = {
  waiting: number
  answered: number
  press1: number
  abandoned: number
  avgWaitSecs: number | null
}

function formatCallerPreview(e164: string | null | undefined): string {
  // Strip everything except digits so we can format US-style.
  const digits = String(e164 || "").replace(/\D/g, "")
  if (digits.length >= 10) {
    // Use last 10 digits (ignore leading country code like 1).
    const local = digits.slice(-10)
    // Non-breaking spaces keep "(872) 359-9461" on one line instead of
    // splitting after the area code when the row is narrow.
    return `(${local.slice(0, 3)})\u00A0${local.slice(3, 6)}-${local.slice(6)}`
  }
  // Fallback: raw E.164 or a friendly unknown label.
  return e164?.trim() || "Unknown caller"
}

function waitHint(enqueuedAt: string): string {
  const ms = Date.now() - new Date(enqueuedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return "just now"
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  return `${mins}m`
}

/** CRM deep-link — seed search with the waiting caller’s phone. */
function crmHrefForCaller(e164: string | null | undefined): string | null {
  const phone = String(e164 || "").trim()
  if (!phone) return null
  return `/dashboard/customers?phone=${encodeURIComponent(phone)}`
}

export type HoldQueueWaitingCardProps = {
  className?: string
  /**
   * When Busy and nobody is waiting, show a quiet one-line hint so operators know
   * where Answer will appear. Hidden when Available (null = no empty chrome).
   */
  showEmptyHint?: boolean
}

export function HoldQueueWaitingCard({
  className,
  showEmptyHint = false,
}: HoldQueueWaitingCardProps) {
  const session = useDashboardSessionOptional()
  const inbound = useInboundCallPanelOptional()
  const ownerUserId = session?.companyUserId?.trim() || ""
  const [callers, setCallers] = useState<QueueCaller[]>([])
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/calls/queue", { credentials: "include" })
      const json = (await res.json()) as {
        data?: { callers?: QueueCaller[]; stats?: QueueStats }
        error?: string
      }
      if (!res.ok) {
        setError(json.error || "Could not load hold queue")
        return
      }
      setCallers(Array.isArray(json.data?.callers) ? json.data!.callers! : [])
      setStats(json.data?.stats ?? null)
      setError(null)
    } catch {
      setError("Could not load hold queue")
    }
  }, [])

  useEffect(() => {
    void refresh()
    const poll = window.setInterval(() => void refresh(), 8_000)
    return () => window.clearInterval(poll)
  }, [refresh])

  // Refresh wait-time labels every 5s while someone is holding.
  useEffect(() => {
    if (callers.length === 0) return
    const id = window.setInterval(() => setTick((n) => n + 1), 5_000)
    return () => window.clearInterval(id)
  }, [callers.length])

  // Live updates when Pusher is configured (same workspace channel as call telemetry).
  useEffect(() => {
    if (!ownerUserId) return
    const pusher = getPusherClient()
    if (!pusher) return
    const channelName = `presence-account-${ownerUserId}`
    const channel = pusher.subscribe(channelName)
    const onUpdate = () => void refresh()
    channel.bind("hold-queue-updated", onUpdate)
    return () => {
      channel.unbind("hold-queue-updated", onUpdate)
      pusher.unsubscribe(channelName)
    }
  }, [ownerUserId, refresh])

  async function answerCaller(id: string) {
    setAnsweringId(id)
    setError(null)
    const waiting = callers.find((c) => c.id === id)
    try {
      const res = await fetch("/api/calls/queue/answer", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueEntryId: id }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { ringingE164?: string; queueEntryId?: string }
      }
      if (!res.ok) {
        setError(json.error || "Answer failed")
        return
      }
      setCallers((prev) => prev.filter((c) => c.id !== id))
      // Open full intake reliably after Answer — slight delay lets the dial settle,
      // then force a fresh manual row so a prior dismiss cannot swallow it.
      if (inbound && waiting?.callerE164) {
        const openIntake = () => {
          inbound.openManualCallPanel({
            phoneNumber: waiting.callerE164!,
            toNumber: waiting.businessLineE164 || undefined,
            callStatus: "answered",
            intakeMode: "full",
          })
        }
        openIntake()
        window.setTimeout(openIntake, 250)
      }
    } catch {
      setError("Answer failed")
    } finally {
      setAnsweringId(null)
      void refresh()
    }
  }

  // Quiet when empty — optional Busy hint only (no amber flash).
  if (callers.length === 0 && !error) {
    if (!showEmptyHint) {
      if (stats && (stats.answered > 0 || stats.press1 > 0 || stats.abandoned > 0)) {
        return (
          <section
            className={cn(
              "rounded-xl border border-border/40 bg-muted/10 px-3 py-2 sm:px-4",
              className
            )}
            aria-label="Hold queue stats"
          >
            <p className="text-[11px] text-muted-foreground">
              Today · Answer {stats.answered} · Press 1 {stats.press1} · Left{" "}
              {stats.abandoned}
              {stats.avgWaitSecs != null ? ` · avg wait ${Math.round(stats.avgWaitSecs)}s` : ""}
            </p>
          </section>
        )
      }
      return null
    }
    return (
      <section
        className={cn(
          "rounded-xl border border-border/40 bg-muted/10 px-3 py-2 sm:px-4",
          className
        )}
        aria-label="Hold queue empty"
      >
        <p className="text-xs font-medium text-muted-foreground">
          Hold queue · nobody waiting
        </p>
        <p className="hidden text-[11px] text-muted-foreground/80 md:block">
          Stay-on-the-line callers appear here with Answer
        </p>
      </section>
    )
  }

  void tick

  return (
    <section
      className={cn(
        "rounded-2xl border border-amber-500/35 bg-amber-500/5 px-4 py-3.5 sm:px-5",
        className
      )}
      aria-label="Hold queue waiting"
      aria-live="polite"
    >
      <div className="mb-2.5 flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
          <PhoneIncoming className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {(() => {
              const answerable = callers.filter(
                (c) =>
                  c.status === "bridging" || isHoldQueueAnswerable(c.status, c.enqueuedAt)
              )
              const lockedMenu = callers.filter(
                (c) => c.status === "holding" && !isHoldQueueAnswerable(c.status, c.enqueuedAt)
              )
              if (answerable.length > 0 && lockedMenu.length > 0) {
                return `${answerable.length} waiting · ${lockedMenu.length} in Busy menu`
              }
              if (lockedMenu.length > 0 && answerable.length === 0) {
                return `${lockedMenu.length} in Busy menu`
              }
              return `${callers.length} waiting`
            })()}
          </h3>
          <p className="hidden text-[11px] text-muted-foreground md:block">
            Answer unlocks a few seconds after the Busy greeting, then while they wait on hold
          </p>
        </div>
      </div>

      {error ? (
        <p className="mb-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="space-y-2">
        {callers.map((c, idx) => {
          // Deep-link to Customers filtered by this caller’s phone.
          const crmHref = crmHrefForCaller(c.callerE164)
          // "holding" = Busy menu greeting window (Answer locked briefly, then unlocks).
          const inBusyMenu = c.status === "holding"
          // Answer after greeting unlock window, or once status is waiting.
          const canAnswer = isHoldQueueAnswerable(c.status, c.enqueuedAt)
          const answerLockedBriefly = inBusyMenu && !canAnswer
          return (
            <li
              key={c.id}
              // Stack on narrow screens so the phone isn’t squeezed beside buttons.
              className="flex flex-col gap-2 rounded-xl border border-border/50 bg-background/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                {/* Keep the full number on one line; tabular nums read cleaner. */}
                <p className="whitespace-nowrap text-sm font-semibold tabular-nums tracking-tight text-foreground">
                  {!inBusyMenu && idx === 0 ? "Next · " : ""}
                  {formatCallerPreview(c.callerE164)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {inBusyMenu
                    ? `In Busy menu · ${waitHint(c.enqueuedAt)}`
                    : `Waiting ${waitHint(c.enqueuedAt)}`}
                  {c.status === "bridging" ? " · connecting…" : ""}
                  {crmHref ? (
                    <>
                      {" · "}
                      <Link
                        href={crmHref}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        CRM
                      </Link>
                    </>
                  ) : null}
                </p>
                {/* Plain guidance while Answer is locked so owners know what to do. */}
                {answerLockedBriefly ? (
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    Greeting playing — Answer unlocks in a few seconds, or send a book link
                    now.
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {c.callerE164 ? (
                  <SendBookLinkButton
                    phone={c.callerE164}
                    businessLine={c.businessLineE164}
                    compact
                    className="!h-9 !min-h-0 px-2 text-[10px]"
                  />
                ) : null}
                {answerLockedBriefly ? (
                  // Short lock only while the Busy greeting speaks (~8s).
                  <span
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200"
                    title={`Answer unlocks after ~${Math.round(busyMenuAnswerUnlockMs() / 1000)}s while the Busy greeting plays.`}
                  >
                    Can’t answer yet
                  </span>
                ) : (
                  // Primary action — take the call (Busy menu past greeting, or hold music).
                  <button
                    type="button"
                    disabled={answeringId === c.id || !canAnswer || c.status === "bridging"}
                    onClick={() => void answerCaller(c.id)}
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50",
                      MOBILE_TAP_TARGET
                    )}
                  >
                    {answeringId === c.id
                      ? "Ringing…"
                      : c.status === "bridging"
                        ? "Connecting…"
                        : "Answer"}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {stats && (stats.answered > 0 || stats.press1 > 0 || stats.abandoned > 0) ? (
        <p className="mt-2.5 hidden text-[10px] text-muted-foreground md:block">
          Today · Answer {stats.answered} · Press 1 {stats.press1} · Left {stats.abandoned}
          {stats.avgWaitSecs != null ? ` · avg wait ${Math.round(stats.avgWaitSecs)}s` : ""}
        </p>
      ) : null}
    </section>
  )
}
