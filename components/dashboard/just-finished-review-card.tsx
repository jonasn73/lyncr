"use client"

// Lines “Latest” card — most recent customer text action; tap for delivery / reply / review status.

import { memo, useCallback, useEffect, useState } from "react"
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
import { useToast } from "@/hooks/use-toast"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import type { LatestCustomerAction } from "@/lib/latest-customer-actions"
import {
  LINES_MOBILE_CARD,
  LINES_MOBILE_SECTION_LABEL,
} from "@/lib/mobile-shell"
import { openSmsAutomationModal } from "@/lib/settings-modals-events"
import { formatTimeAgo } from "@/lib/today-board"
import { cn } from "@/lib/utils"
import { WORKSPACE_SHEET_CLASS } from "@/lib/workspace-sheet-classes"

export const JustFinishedReviewCard = memo(function JustFinishedReviewCard({
  compact = false,
}: {
  compact?: boolean
}) {
  const { toast } = useToast()
  const router = useRouter()
  const { activeOrganizationId } = useDashboardWorkspace()
  const [items, setItems] = useState<LatestCustomerAction[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<LatestCustomerAction | null>(null)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [markingOpened, setMarkingOpened] = useState(false)

  const load = useCallback(async () => {
    try {
      const orgQs =
        activeOrganizationId && !activeOrganizationId.startsWith("legacy-")
          ? `?organization_id=${encodeURIComponent(activeOrganizationId)}`
          : ""
      const res = await fetch(`/api/owner/latest${orgQs}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json().catch(() => null)) as {
        data?: { latest?: LatestCustomerAction[] }
        error?: string
      } | null
      if (!res.ok || !json?.data) return
      setItems(json.data.latest ?? [])
    } catch {
      /* keep last good list */
    } finally {
      setLoading(false)
    }
  }, [activeOrganizationId])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(id)
  }, [load])

  // Keep the open detail sheet in sync when delivery / reply updates arrive.
  const selectedPhone = selected?.customerPhone ?? null
  useEffect(() => {
    if (!selectedPhone) return
    const next = items.find((i) => i.customerPhone === selectedPhone)
    if (next) setSelected(next)
  }, [items, selectedPhone])

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
          description: "Latest will show Sent, then Delivered when the carrier confirms.",
        })
        await load()
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
    [load, toast]
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
        toast({ title: "Marked review received", description: "Latest status updated." })
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
      setSelected(null)
      router.push(`/dashboard/messages?phone=${encodeURIComponent(phone)}`)
    },
    [router]
  )

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
            <p
              className={
                compact
                  ? LINES_MOBILE_SECTION_LABEL
                  : "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              }
            >
              Latest
            </p>
            <p className={cn("font-semibold text-foreground", compact ? "text-sm" : "mt-0.5 text-base")}>
              Recent activity
            </p>
            <p className={cn("text-zinc-500", compact ? "text-xs leading-snug" : "mt-1 text-sm")}>
              Finished jobs, texts you send, and customer replies.
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
        ) : items.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border/60 px-3 py-3 text-xs text-zinc-500">
            Nothing yet today. Finish a job or send Thanks + review — it’ll show up here with delivery
            status.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelected(item)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    item.event === "replied"
                      ? "border-sky-500/25 bg-sky-500/5 hover:bg-sky-500/10"
                      : "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{item.headline}</p>
                      <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">
                        {formatTimeAgo(item.at)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs font-medium text-zinc-400">{item.statusLine}</p>
                    {item.preview ? (
                      <p className="mt-1 truncate text-[11px] text-zinc-500">{item.preview}</p>
                    ) : null}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" variant="drawer" className={WORKSPACE_SHEET_CLASS}>
          {selected ? (
            <LatestActionDetail
              item={selected}
              busyJobId={busyJobId}
              markingOpened={markingOpened}
              onSendThanks={(jobId) => void sendThanksReview(jobId)}
              onMarkReviewOpened={(jobId) => void markReviewOpened(jobId)}
              onOpenMessages={openInMessages}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
})

function LatestActionDetail({
  item,
  busyJobId,
  markingOpened,
  onSendThanks,
  onMarkReviewOpened,
  onOpenMessages,
}: {
  item: LatestCustomerAction
  busyJobId: string | null
  markingOpened: boolean
  onSendThanks: (jobId: string) => void
  onMarkReviewOpened: (jobId: string) => void
  onOpenMessages: (phone: string) => void
}) {
  const phoneLabel = item.customerPhone
    ? formatPhoneDisplay(item.customerPhone) || item.customerPhone
    : "No phone on file"
  const alreadySentReview = item.kind === "review" && Boolean(item.lastOutbound)

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
      detail: "Not sent yet — use the button below",
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
  }

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="shrink-0 border-b border-border/60 px-5 py-4 text-left">
        <SheetTitle className="text-base font-semibold text-foreground">
          {item.customerName}
        </SheetTitle>
        <p className="text-sm text-zinc-500">{phoneLabel}</p>
        <p className="mt-1 text-sm font-medium text-foreground">{item.headline}</p>
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
                    : "border-border/60 bg-muted/20"
                )}
              >
                <p
                  className={cn(
                    "text-sm font-medium",
                    step.done ? "text-emerald-200" : "text-zinc-400"
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

        {item.lastOutbound ? (
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Your text
            </p>
            <p className="mt-2 whitespace-pre-wrap rounded-xl border border-border/60 bg-card/60 px-3 py-2.5 text-sm text-foreground">
              {item.lastOutbound.body}
            </p>
          </section>
        ) : null}

        {item.lastInbound ? (
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Their reply
            </p>
            <p className="mt-2 whitespace-pre-wrap rounded-xl border border-sky-500/25 bg-sky-500/5 px-3 py-2.5 text-sm text-foreground">
              {item.lastInbound.body}
            </p>
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
            Open in Messages
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
              alreadySentReview
                ? "border border-border/60 bg-muted/30 text-zinc-300 hover:bg-muted/50"
                : "bg-emerald-600/90 text-white hover:bg-emerald-500"
            )}
          >
            {busyJobId === item.completedJobId ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {alreadySentReview ? "Send again" : "Send Thanks + review"}
          </button>
        ) : null}
      </div>
    </div>
  )
}
