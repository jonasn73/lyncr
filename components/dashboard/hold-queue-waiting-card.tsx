"use client"

// Lines — Hold queue waiting list + Answer (Busy stay-on-the-line callers).

import { useCallback, useEffect, useState } from "react"
import { PhoneIncoming } from "lucide-react"
import { cn } from "@/lib/utils"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { workspacePresenceChannel } from "@/lib/active-operator"
import { useDashboardSessionOptional } from "@/components/dashboard-session-context"

type QueueCaller = {
  id: string
  callControlId: string
  callerE164: string | null
  businessLineE164: string | null
  status: string
  enqueuedAt: string
  queueName: string
}

function formatCallerPreview(e164: string | null | undefined): string {
  const digits = String(e164 || "").replace(/\D/g, "")
  if (digits.length >= 10) {
    const local = digits.slice(-10)
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
  }
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

export function HoldQueueWaitingCard({ className }: { className?: string }) {
  const session = useDashboardSessionOptional()
  const ownerUserId = session?.companyUserId?.trim() || ""
  const [callers, setCallers] = useState<QueueCaller[]>([])
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/calls/queue", { credentials: "include" })
      const json = (await res.json()) as {
        data?: { callers?: QueueCaller[] }
        error?: string
      }
      if (!res.ok) {
        setError(json.error || "Could not load hold queue")
        return
      }
      setCallers(Array.isArray(json.data?.callers) ? json.data!.callers! : [])
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

  // Live updates when Pusher is configured (same workspace channel as call telemetry).
  useEffect(() => {
    if (!ownerUserId) return
    const pusher = getPusherClient()
    if (!pusher) return
    const channelName = workspacePresenceChannel(ownerUserId)
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
    try {
      const res = await fetch("/api/calls/queue/answer", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueEntryId: id }),
      })
      const json = (await res.json()) as { error?: string; data?: { ringingE164?: string } }
      if (!res.ok) {
        setError(json.error || "Answer failed")
        return
      }
      // Optimistic — dial is ringing the agent cell.
      setCallers((prev) => prev.filter((c) => c.id !== id))
    } catch {
      setError("Answer failed")
    } finally {
      setAnsweringId(null)
      void refresh()
    }
  }

  if (callers.length === 0 && !error) return null

  return (
    <section
      className={cn(
        "rounded-2xl border border-amber-500/35 bg-amber-500/5 px-4 py-3.5 sm:px-5",
        className
      )}
      aria-label="Hold queue waiting"
    >
      <div className="mb-2.5 flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
          <PhoneIncoming className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {callers.length} waiting
          </h3>
          <p className="hidden text-[11px] text-muted-foreground md:block">
            Busy hold queue — Answer rings your phone, then connects the caller
          </p>
        </div>
      </div>

      {error ? (
        <p className="mb-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="space-y-2">
        {callers.map((c, idx) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/60 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {idx === 0 ? "Next · " : ""}
                {formatCallerPreview(c.callerE164)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Waiting {waitHint(c.enqueuedAt)}
                {c.status === "bridging" ? " · connecting…" : ""}
              </p>
            </div>
            <button
              type="button"
              disabled={answeringId === c.id || c.status === "bridging"}
              onClick={() => void answerCaller(c.id)}
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50",
                MOBILE_TAP_TARGET
              )}
            >
              {answeringId === c.id ? "Ringing…" : "Answer"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
