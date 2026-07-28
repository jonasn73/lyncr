"use client"

// Lines “Latest” card — hot work only: unreplied inbound + jobs needing review SMS.

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  MessageSquare,
  Settings2,
  Star,
} from "lucide-react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ToastAction } from "@/components/ui/toast"
import { useToast } from "@/hooks/use-toast"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import type { LatestCustomerAction } from "@/lib/latest-customer-actions"
import { useOwnerLatest } from "@/lib/hooks/use-owner-latest"
import { isLatestReplyUnread, markLatestReplySeen } from "@/lib/latest-seen"
import {
  LINES_MOBILE_CARD,
  LINES_MOBILE_SECTION_LABEL,
} from "@/lib/mobile-shell"
import { buildSchedulerFocusUrl } from "@/lib/scheduler-focus-url"
import { openSmsAutomationModal } from "@/lib/settings-modals-events"
import { formatSmsDeliveryLabel } from "@/lib/sms-delivery-labels"
import { formatTimeAgo } from "@/lib/today-board"
import type { SmsMessage } from "@/lib/types"
import { cn } from "@/lib/utils"
import { WORKSPACE_SHEET_CLASS } from "@/lib/workspace-sheet-classes"

/** Last 10 digits — matches Messages inbox / Activity deep-links across formats. */
function phoneMatchKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10)
}

/** Same clock style as Messages conversation bubbles. */
function formatMessageTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

/** Keep only SMS for this customer phone (E.164 or display formats). */
function filterThreadForPhone(messages: SmsMessage[], phone: string): SmsMessage[] {
  const key = phoneMatchKey(phone)
  if (key.length < 10) return []
  const matched = messages.filter((m) => {
    const customer = phoneMatchKey(m.customer_phone || "")
    if (customer === key) return true
    // Fallback: inbound from / outbound to this number.
    const peer =
      m.direction === "inbound"
        ? phoneMatchKey(m.from_number || "")
        : phoneMatchKey(m.to_number || "")
    return peer === key
  })
  // Oldest → newest (Messages-consistent; newest at bottom).
  return matched.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
}

export const JustFinishedReviewCard = memo(function JustFinishedReviewCard({
  compact = false,
}: {
  compact?: boolean
}) {
  const { toast } = useToast()
  const router = useRouter()
  const { activeOrganizationId } = useDashboardWorkspace()
  // Shared cache + fetch — both CSS layout twins reuse one request / last paint.
  const { items, loading, refresh: load, setItems } = useOwnerLatest(activeOrganizationId)
  const [selected, setSelected] = useState<LatestCustomerAction | null>(null)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  /** Job ids whose last Thanks+review send failed — show Retry on the row. */
  const [failedReviewJobIds, setFailedReviewJobIds] = useState<Set<string>>(() => new Set())
  const [markingOpened, setMarkingOpened] = useState(false)
  // Bumps when we mark a reply seen so unread dots re-render.
  const [seenTick, setSeenTick] = useState(0)
  const unrepliedCount = items.filter((i) => i.event === "replied").length

  // Keep the open detail sheet in sync when delivery / reply updates arrive.
  const selectedPhone = selected?.customerPhone ?? null
  useEffect(() => {
    if (!selectedPhone) return
    const next = items.find((i) => i.customerPhone === selectedPhone)
    if (next) setSelected(next)
    else setSelected(null)
  }, [items, selectedPhone])

  const markSeen = useCallback((phone: string) => {
    if (!phone.trim()) return
    markLatestReplySeen(phone)
    setSeenTick((n) => n + 1)
  }, [])

  const openDetail = useCallback(
    (item: LatestCustomerAction) => {
      if (item.event === "replied" && item.customerPhone) {
        markSeen(item.customerPhone)
      }
      setSelected(item)
    },
    [markSeen]
  )

  // Job finished → JobDetailDrawer (Send review / Complete live there too).
  const openJobDrawer = useCallback(
    (jobId: string) => {
      setSelected(null)
      router.push(buildSchedulerFocusUrl(jobId))
    },
    [router]
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
        setFailedReviewJobIds((prev) => {
          if (!prev.has(jobId)) return prev
          const next = new Set(prev)
          next.delete(jobId)
          return next
        })
        // Outbound hide: drop this job from Latest immediately (no “Review sent” card).
        setItems((prev) =>
          prev.filter((i) => i.completedJobId !== jobId && i.id !== `job-${jobId}`)
        )
        if (selected?.completedJobId === jobId) setSelected(null)
        toast({
          title: "Thanks + review sent",
          description: "Removed from Latest. It’ll come back only if they reply.",
        })
        await load()
      } catch (e) {
        setFailedReviewJobIds((prev) => new Set(prev).add(jobId))
        toast({
          title: "Could not send thanks",
          description: e instanceof Error ? e.message : "Try again in a moment.",
          variant: "destructive",
          action: (
            <ToastAction altText="Retry send" onClick={() => void sendThanksReview(jobId)}>
              Retry
            </ToastAction>
          ),
        })
      } finally {
        setBusyJobId(null)
      }
    },
    [load, selected?.completedJobId, setItems, toast]
  )

  const markReviewOpened = useCallback(
    async (jobId: string) => {
      setMarkingOpened(true)
      try {
        const res = await fetch(
          `/api/owner/jobs/${encodeURIComponent(jobId)}/review-opened`,
          { method: "POST", credentials: "include" }
        )
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) throw new Error(json?.error || "Could not update")
        toast({ title: "Marked review received", description: "Status updated." })
        await load()
      } catch (e) {
        toast({
          title: "Could not update",
          description: e instanceof Error ? e.message : "Try again.",
          variant: "destructive",
        })
      } finally {
        setMarkingOpened(false)
      }
    },
    [load, toast]
  )

  const openInMessages = useCallback(
    (phone: string) => {
      if (phone.trim()) markSeen(phone)
      setSelected(null)
      router.push(`/dashboard/messages?phone=${encodeURIComponent(phone)}`)
    },
    [markSeen, router]
  )

  // Re-read unread dots when returning to the tab (Messages may have marked seen).
  useEffect(() => {
    const onFocus = () => setSeenTick((n) => n + 1)
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])

  return (
    <>
      <div
        className={cn(
          "w-full text-left",
          compact ? cn(LINES_MOBILE_CARD, "px-3 py-3") : "rounded-2xl border border-border/70 bg-card/80 p-4 sm:p-5"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p
                className={
                  compact
                    ? LINES_MOBILE_SECTION_LABEL
                    : "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                }
              >
                Latest
              </p>
              {/* Unreplied inbound count — hot inbox only. */}
              {unrepliedCount > 0 ? (
                <span
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500/25 px-1.5 text-[10px] font-bold tabular-nums text-sky-100 ring-1 ring-sky-400/40"
                  aria-label={`${unrepliedCount} unreplied`}
                >
                  {unrepliedCount}
                </span>
              ) : null}
            </div>
            <p className={cn("font-semibold text-foreground", compact ? "text-sm" : "mt-0.5 text-base")}>
              Recent activity
            </p>
            <p className={cn("text-zinc-500", compact ? "text-xs leading-snug" : "mt-1 text-sm")}>
              Replies waiting on you, and finished jobs that still need a review text.
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

        {/* Reserve list height so refetch doesn’t collapse Latest into “Loading…”. */}
        <div className="mt-3 min-h-[3.5rem]">
          {loading && items.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/60 px-3 py-3 text-xs text-zinc-500">
              Nothing hot right now. Customer replies and finished jobs that need a review text show up
              here.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => {
                // seenTick re-reads localStorage after markSeen / window focus.
                void seenTick
                const unread =
                  item.event === "replied" &&
                  Boolean(item.lastInbound) &&
                  isLatestReplyUnread(item.customerPhone, item.lastInbound!.created_at)
                const isJob = item.event === "job_finished"
                return (
                  <li key={item.id}>
                    <div
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        isJob
                          ? "border-amber-500/40 bg-amber-500/10"
                          : unread
                            ? "border-sky-400/45 bg-sky-500/15 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.12)]"
                            : "border-sky-500/25 bg-sky-500/5"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => openDetail(item)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        {item.event === "replied" ? (
                          <span
                            className={cn(
                              "mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full",
                              unread ? "bg-sky-400 shadow-[0_0_0_3px_rgba(56,189,248,0.25)]" : "bg-sky-500/35"
                            )}
                            aria-hidden
                          />
                        ) : (
                          <span
                            className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400"
                            aria-hidden
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {item.headline}
                            </p>
                            <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">
                              {formatTimeAgo(item.at)}
                            </span>
                          </div>
                          <p
                            className={cn(
                              "mt-0.5 truncate text-xs font-semibold",
                              isJob ? "text-amber-200" : unread ? "text-sky-200" : "text-sky-300/80"
                            )}
                          >
                            {item.statusLine}
                          </p>
                          {item.preview ? (
                            <p className="mt-1 truncate text-[11px] text-zinc-500">{item.preview}</p>
                          ) : null}
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                      </button>
                      {item.event === "replied" && item.customerPhone ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openInMessages(item.customerPhone)
                          }}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1.5 text-[11px] font-bold text-sky-100 hover:bg-sky-500/25"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          Reply
                        </button>
                      ) : null}
                      {isJob && item.completedJobId ? (
                        <button
                          type="button"
                          disabled={busyJobId === item.completedJobId}
                          onClick={(e) => {
                            e.stopPropagation()
                            void sendThanksReview(item.completedJobId!)
                          }}
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-50",
                            failedReviewJobIds.has(item.completedJobId)
                              ? "bg-rose-500/90 text-white hover:bg-rose-400"
                              : "bg-amber-500/90 text-zinc-950 hover:bg-amber-400"
                          )}
                        >
                          {busyJobId === item.completedJobId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Star className="h-3.5 w-3.5" />
                          )}
                          {failedReviewJobIds.has(item.completedJobId) ? "Retry" : "Send"}
                        </button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" variant="drawer" className={WORKSPACE_SHEET_CLASS}>
          {selected ? (
            <LatestActionDetail
              item={selected}
              organizationId={activeOrganizationId}
              busyJobId={busyJobId}
              markingOpened={markingOpened}
              sendFailed={
                Boolean(
                  selected.completedJobId && failedReviewJobIds.has(selected.completedJobId)
                )
              }
              onSendThanks={(jobId) => void sendThanksReview(jobId)}
              onMarkReviewOpened={(jobId) => void markReviewOpened(jobId)}
              onOpenMessages={openInMessages}
              onOpenJob={openJobDrawer}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
})

function LatestActionDetail({
  item,
  organizationId,
  busyJobId,
  markingOpened,
  sendFailed,
  onSendThanks,
  onMarkReviewOpened,
  onOpenMessages,
  onOpenJob,
}: {
  item: LatestCustomerAction
  organizationId: string | null
  busyJobId: string | null
  markingOpened: boolean
  sendFailed: boolean
  onSendThanks: (jobId: string) => void
  onMarkReviewOpened: (jobId: string) => void
  onOpenMessages: (phone: string) => void
  onOpenJob: (jobId: string) => void
}) {
  const phoneLabel = item.customerPhone
    ? formatPhoneDisplay(item.customerPhone) || item.customerPhone
    : "No phone on file"
  const needsReviewSend = item.event === "job_finished" && Boolean(item.completedJobId)
  // Full SMS history only for reply detail — job “Send review” rows stay status-only.
  const showSmsThread = item.event === "replied" && Boolean(item.customerPhone?.trim())
  // Simple delivery / open status when 119 columns are present on the last outbound.
  const reviewDeliveryLabel = item.lastOutbound
    ? formatSmsDeliveryLabel({ ...item.lastOutbound, direction: "outbound" })
    : null
  const [threadMessages, setThreadMessages] = useState<SmsMessage[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadError, setThreadError] = useState<string | null>(null)
  const threadBottomRef = useRef<HTMLDivElement | null>(null)

  const orgId =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : null

  // Load the same Messages inbox feed, then filter to this phone.
  useEffect(() => {
    if (!showSmsThread || !item.customerPhone) return
    let cancelled = false
    setThreadLoading(true)
    setThreadError(null)
    const qs = orgId
      ? `?organization_id=${encodeURIComponent(orgId)}&limit=200`
      : "?limit=200"
    void (async () => {
      try {
        const res = await fetch(`/api/messaging${qs}`, {
          credentials: "include",
          cache: "no-store",
        })
        const json = (await res.json()) as {
          error?: string
          data?: { messages?: SmsMessage[] }
        }
        if (!res.ok) throw new Error(json.error || "Could not load messages")
        if (cancelled) return
        const all = Array.isArray(json.data?.messages) ? json.data!.messages! : []
        setThreadMessages(filterThreadForPhone(all, item.customerPhone))
      } catch (e) {
        if (cancelled) return
        setThreadError(e instanceof Error ? e.message : "Could not load messages")
        setThreadMessages([])
      } finally {
        if (!cancelled) setThreadLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showSmsThread, item.customerPhone, orgId])

  // Scroll to newest bubble after the thread paints.
  useEffect(() => {
    if (!showSmsThread || threadLoading) return
    threadBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [showSmsThread, threadLoading, threadMessages.length])

  const steps: Array<{ label: string; done: boolean; detail?: string }> = []
  if (item.event === "job_finished") {
    steps.push({
      label: "Job finished",
      done: true,
      detail: formatTimeAgo(item.at),
    })
    steps.push({
      label: "Thanks + review text",
      done: false,
      detail: sendFailed
        ? "Failed — tap Retry below"
        : "Not sent yet — use the button below",
    })
  }
  if (item.lastOutbound) {
    steps.push({
      label: "Text sent",
      done: true,
      detail: formatTimeAgo(item.lastOutbound.created_at),
    })
    const delivered = Boolean(
      item.lastOutbound.delivered_at || item.lastOutbound.status === "delivered"
    )
    const failed = Boolean(item.lastOutbound.failed_at || item.lastOutbound.status === "failed")
    const tracked = item.lastOutbound.deliveryTracked !== false
    // If they opened the review link / replied, the phone clearly got the text.
    const inferredDelivered = item.reviewLinkOpened || Boolean(item.lastInbound)
    if (failed) {
      steps.push({
        label: "Delivery failed",
        done: true,
        detail: item.lastOutbound.delivery_error || "Carrier rejected",
      })
    } else if (delivered || inferredDelivered) {
      steps.push({
        label: "Delivered to phone",
        done: true,
        detail: inferredDelivered && !delivered ? "Confirmed (customer engaged)" : "Delivered",
      })
    } else if (!tracked) {
      steps.push({
        label: "Delivered to phone",
        done: true,
        detail: "Sent — carrier receipt wasn’t available for this text",
      })
    } else {
      steps.push({
        label: "Delivered to phone",
        done: false,
        detail: "Waiting for carrier…",
      })
    }
  }
  if (item.kind === "review") {
    steps.push({
      label: "Review link opened",
      done: item.reviewLinkOpened,
      detail: item.reviewLinkOpened
        ? item.reviewLinkClicks > 1
          ? `Opened ${item.reviewLinkClicks}×`
          : "Customer opened / left a review"
        : "Not tracked yet — older texts used a direct Google link",
    })
  }
  if (item.lastInbound) {
    steps.push({
      label: "Customer replied",
      done: true,
      detail: formatTimeAgo(item.lastInbound.created_at),
    })
    steps.push({
      label: "Needs reply",
      done: false,
      detail: "Open Messages to answer",
    })
  }

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="shrink-0 border-b border-border/60 px-5 py-4 text-left">
        <SheetTitle className="text-base font-semibold text-foreground">
          {item.customerName}
        </SheetTitle>
        <p className="text-sm text-zinc-500">{phoneLabel}</p>
        <p className="mt-1 text-sm font-medium text-foreground">{item.headline}</p>
        {item.event === "replied" ? (
          <p className="mt-1 text-xs font-semibold text-sky-300">Needs reply</p>
        ) : null}
        {item.reviewLinkOpened ? (
          <p className="mt-1 text-xs font-semibold text-emerald-300">Opened</p>
        ) : reviewDeliveryLabel ? (
          <p
            className={cn(
              "mt-1 text-xs font-semibold",
              reviewDeliveryLabel === "Failed" ? "text-rose-300" : "text-zinc-400"
            )}
          >
            {reviewDeliveryLabel}
          </p>
        ) : null}
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Status
          </p>
          <ul className="mt-2 space-y-2">
            {steps.map((step) => (
              <li
                key={step.label}
                className={cn(
                  "rounded-xl border px-3 py-2.5",
                  step.done
                    ? "border-emerald-500/25 bg-emerald-500/5"
                    : step.label === "Needs reply"
                      ? "border-sky-500/35 bg-sky-500/10"
                      : "border-border/60 bg-muted/20"
                )}
              >
                <p
                  className={cn(
                    "text-sm font-medium",
                    step.done
                      ? "text-emerald-200"
                      : step.label === "Needs reply"
                        ? "text-sky-200"
                        : "text-zinc-400"
                  )}
                >
                  {step.done ? "✓ " : "○ "}
                  {step.label}
                </p>
                {step.detail ? (
                  <p className="mt-0.5 text-xs text-zinc-500">{step.detail}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {showSmsThread ? (
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Conversation
            </p>
            {threadLoading ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading messages…
              </div>
            ) : threadError ? (
              <p className="mt-2 text-xs text-rose-300">{threadError}</p>
            ) : threadMessages.length === 0 ? (
              // Fallback: still show last pair from Latest if the feed is empty.
              <div className="mt-2 space-y-3">
                {item.lastOutbound ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Your text
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap rounded-xl border border-border/60 bg-card/60 px-3 py-2.5 text-sm text-foreground">
                      {item.lastOutbound.body}
                    </p>
                  </div>
                ) : null}
                {item.lastInbound ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Their reply
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap rounded-xl border border-sky-500/35 bg-sky-500/10 px-3 py-2.5 text-sm font-medium text-foreground">
                      {item.lastInbound.body}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 max-h-[min(50vh,22rem)] space-y-2 overflow-y-auto rounded-xl border border-border/50 bg-muted/10 px-2.5 py-3">
                {threadMessages.map((msg) => {
                  const outbound = msg.direction === "outbound"
                  const deliveryLabel = outbound ? formatSmsDeliveryLabel(msg) : null
                  return (
                    <div
                      key={msg.id}
                      className={cn("flex", outbound ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-snug",
                          outbound
                            ? msg.status === "failed"
                              ? "rounded-br-md bg-rose-700 text-white"
                              : "rounded-br-md bg-emerald-600 text-white"
                            : "rounded-bl-md border border-sky-500/35 bg-sky-500/10 text-foreground"
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                        <p
                          className={cn(
                            "mt-1 text-[10px] tabular-nums",
                            outbound ? "text-emerald-100/80" : "text-muted-foreground",
                            outbound && msg.status === "failed" && "text-rose-100/90"
                          )}
                        >
                          {formatMessageTime(msg.created_at)}
                          {deliveryLabel ? ` · ${deliveryLabel}` : ""}
                        </p>
                        {outbound && msg.status === "failed" && msg.delivery_error ? (
                          <p className="mt-0.5 text-[10px] leading-snug text-rose-100/80">
                            {msg.delivery_error}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
                <div ref={threadBottomRef} />
              </div>
            )}
          </section>
        ) : null}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border/60 px-5 py-4">
        {item.customerPhone ? (
          <button
            type="button"
            onClick={() => onOpenMessages(item.customerPhone)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-sky-500/35 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-200 hover:bg-sky-500/20"
          >
            <MessageSquare className="h-4 w-4" />
            {item.event === "replied" ? "Reply in Messages" : "Open in Messages"}
          </button>
        ) : null}
        {item.completedJobId && item.kind === "review" && !item.reviewLinkOpened ? (
          <button
            type="button"
            disabled={markingOpened}
            onClick={() => onMarkReviewOpened(item.completedJobId!)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
          >
            {markingOpened ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Star className="h-4 w-4" />
            )}
            Mark review received
          </button>
        ) : null}
        {item.completedJobId ? (
          <button
            type="button"
            disabled={busyJobId === item.completedJobId}
            onClick={() => onSendThanks(item.completedJobId!)}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50",
              sendFailed
                ? "bg-rose-500 text-white hover:bg-rose-400"
                : needsReviewSend
                  ? "bg-amber-500 text-zinc-950 hover:bg-amber-400"
                  : "border border-amber-500/35 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
            )}
          >
            {busyJobId === item.completedJobId ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {sendFailed ? "Retry thanks + review" : "Send thanks + review"}
          </button>
        ) : null}
        {/* Same JobDetailDrawer as Scheduler / CRM View job (Complete + Send review live there too). */}
        {item.completedJobId ? (
          <button
            type="button"
            onClick={() => onOpenJob(item.completedJobId!)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border/60 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-muted/40"
          >
            Open job
          </button>
        ) : null}
      </div>
    </div>
  )
}
