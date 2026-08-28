"use client"

// Lines Alerts — unreplied inbound, customer payments, jobs needing review SMS.
// Hidden when empty; opening clears book/paid rows; Clear dismisses any row (incl. job_finished).
// Book-form rows open a booking-details sheet (not “new intake”); Book job continues work.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useInboundCallPanelOptional } from "@/lib/inbound-call-panel-context"
import { useRecentArrivals } from "@/lib/hooks/use-recent-arrivals"
import {
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Eye,
  Loader2,
  MessageSquare,
  Phone,
  Send,
  Sparkles,
  Star,
  UserRound,
  X,
  XCircle,
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
import {
  BOOK_JOB_KIND_OPTIONS,
  serviceQuoteTypeIdFromBookJobKind,
} from "@/lib/book-customer-request"
import { continueOpenQuoteStep } from "@/lib/callback-intake-chooser"
import { isSubstantialStreetAddress } from "@/lib/intake-address-helpers"
import { serviceTypeRequiresVehicle } from "@/lib/job-intake-fields"
import type { ServiceQuoteTypeId } from "@/lib/service-rate-card"
import { buildUnreachableFollowUpSms } from "@/lib/unreachable-follow-up"
import {
  clearBookFormDetailsHandoff,
  consumeBookFormReopenPending,
  LYNCR_REOPEN_BOOK_FORM_DETAIL_EVENT,
  peekBookFormDetailsHandoff,
  writeBookFormDetailsHandoff,
} from "@/lib/book-form-details-handoff"
import type { LatestCustomerAction } from "@/lib/latest-customer-actions"
import { useOwnerLatest } from "@/lib/hooks/use-owner-latest"
import {
  dismissLatestAlert,
  excludeReadRepliesFromLatest,
  isDismissOnOpenLatestEvent,
  LATEST_SEEN_CHANGED_EVENT,
  markLatestAttentionOpened,
  markLatestReplySeen,
} from "@/lib/latest-seen"
import { LINES_MOBILE_SECTION_LABEL } from "@/lib/mobile-shell"
import { buildTelHref } from "@/lib/phone-e164"
import { buildSchedulerFocusUrl } from "@/lib/scheduler-focus-url"
import { formatSmsDeliveryLabel } from "@/lib/sms-delivery-labels"
import {
  buildHeuristicSmsReplySuggestions,
  buildJobFinishedFollowUpChips,
  extractBusinessNameFromSmsBody,
  extractVehicleFromSmsBody,
  type SmsReplyChip,
  type SmsReplyIntent,
} from "@/lib/sms-reply-suggestions"
import { formatTimeAgo } from "@/lib/today-board"
import {
  calendarDayKeyInZone,
  formatListTimeLabel,
  resolveOwnerTimezone,
} from "@/lib/browser-timezone-cookie"
import type { SmsMessage } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Human service label from book-form chips (Key copy, Lockout, …). */
function bookFormServiceLabel(item: LatestCustomerAction): string {
  // Prefer the short chip the customer tapped on /book.
  const kind = String(item.bookFormJobKind ?? "")
    .trim()
    .toLowerCase()
  const fromChip = BOOK_JOB_KIND_OPTIONS.find((o) => o.id === kind)?.chip
  if (fromChip) return fromChip
  // Fall back to stored job_type text, then a generic label.
  const typed = String(item.bookFormJobType ?? "").trim()
  return typed || "Service"
}

/** Year · make · model from submitted book-form fields. */
function bookFormVehicleLabel(item: LatestCustomerAction): string {
  return [item.bookFormVehicleYear, item.bookFormVehicleMake, item.bookFormVehicleModel]
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(" ")
}

/** Last 10 digits — matches Messages inbox / Activity deep-links across formats. */
function phoneMatchKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10)
}

/** Same clock style as Messages conversation bubbles. */
function formatMessageTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const tz = resolveOwnerTimezone()
  if (calendarDayKeyInZone(d, tz) === calendarDayKeyInZone(new Date(), tz)) {
    return formatListTimeLabel(d, tz)
  }
  return d.toLocaleDateString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  })
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
  const pathname = usePathname()
  const { activeOrganizationId } = useDashboardWorkspace()
  const inbound = useInboundCallPanelOptional()
  // Shared cache + fetch — both CSS layout twins reuse one request / last paint.
  const { items: rawItems, loading, refresh: load, setItems } = useOwnerLatest(activeOrganizationId)
  const [selected, setSelected] = useState<LatestCustomerAction | null>(null)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  /** Job ids whose last Thanks+review send failed — show Retry on the row. */
  const [failedReviewJobIds, setFailedReviewJobIds] = useState<Set<string>>(() => new Set())
  const [markingOpened, setMarkingOpened] = useState(false)
  // Bumps when we mark a reply seen so read rows leave Latest immediately.
  const [seenTick, setSeenTick] = useState(0)
  // Drop opened replies / book forms / payments; job-finished review items stay.
  const items = useMemo(() => {
    void seenTick
    return excludeReadRepliesFromLatest(rawItems)
  }, [rawItems, seenTick])

  // Poll-refreshed list (not Pusher-pushed) — "arrival" is computed client-side by diffing
  // ids against the previous render, then briefly pulsed so a new alert doesn't just
  // silently appear.
  const itemIds = useMemo(() => items.map((item) => item.id), [items])
  const recentItemIds = useRecentArrivals(itemIds)

  // Keep the open detail sheet in sync when delivery / reply updates arrive.
  // Skip no-op setState so list refreshes cannot churn the Sheet open state (#185).
  // Do NOT close when the row was dismissed as read — selected stays until the user closes.
  const selectedId = selected?.id ?? null
  useEffect(() => {
    if (!selectedId) return
    const next = rawItems.find((i) => i.id === selectedId)
    if (!next) return
    setSelected((prev) => {
      if (
        prev &&
        prev.id === next.id &&
        prev.at === next.at &&
        prev.event === next.event &&
        prev.lastOutbound?.id === next.lastOutbound?.id &&
        prev.lastInbound?.id === next.lastInbound?.id
      ) {
        return prev
      }
      return next
    })
  }, [rawItems, selectedId])

  const skipAmberLeftoverForItem = useCallback(
    (item: LatestCustomerAction) => {
      const leadId = String(item.bookFormLeadId || "").trim()
      const phone = String(item.customerPhone || "").trim()
      if (!leadId && !phone) return
      // Close Amber leftover so a later 15-min cover does not text them.
      void fetch("/api/amber", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "skip_leftover",
          organization_id: activeOrganizationId || undefined,
          lead_id: leadId || undefined,
          customer_phone: phone || undefined,
        }),
      }).catch(() => {})
    },
    [activeOrganizationId]
  )

  /** Persist seen + drop from Latest immediately (reply / book / payment). */
  const markAttentionOpened = useCallback(
    (item: LatestCustomerAction) => {
      markLatestAttentionOpened(item)
      setSeenTick((n) => n + 1)
      if (item.event === "replied" && item.customerPhone) {
        const key = phoneMatchKey(item.customerPhone)
        setItems((prev) =>
          prev.filter(
            (i) => !(i.event === "replied" && phoneMatchKey(i.customerPhone) === key)
          )
        )
        return
      }
      if (isDismissOnOpenLatestEvent(item.event, item)) {
        setItems((prev) => prev.filter((i) => i.id !== item.id))
      }
    },
    [setItems]
  )

  const markSeen = useCallback((phone: string) => {
    if (!phone.trim()) return
    markLatestReplySeen(phone)
    setSeenTick((n) => n + 1)
    // Optimistic: remove this reply from the shared Latest list + cache.
    const key = phoneMatchKey(phone)
    setItems((prev) =>
      prev.filter(
        (i) => !(i.event === "replied" && phoneMatchKey(i.customerPhone) === key)
      )
    )
  }, [setItems])

  const openDetail = useCallback(
    (item: LatestCustomerAction) => {
      // Replies / paid still count as read. Book forms stay on Lines until Book, Call, or Clear.
      markAttentionOpened(item)
      // Stash book-form fields so Messages can offer “View booking details”.
      if (item.event === "book_form") writeBookFormDetailsHandoff(item)
      setSelected(item)
    },
    [markAttentionOpened]
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
        // Drop standalone job-finished rows; keep payment cards but clear nested thanks CTA.
        setItems((prev) =>
          prev.flatMap((i) => {
            if (i.id === `job-${jobId}` || (i.event === "job_finished" && i.completedJobId === jobId)) {
              return []
            }
            if (i.completedJobId === jobId && i.thanksReviewPending) {
              return [
                {
                  ...i,
                  thanksReviewPending: false,
                  statusLine: "Payment received",
                },
              ]
            }
            return [i]
          })
        )
        if (selected?.completedJobId === jobId) {
          if (selected.event === "customer_paid") {
            setSelected({
              ...selected,
              thanksReviewPending: false,
              statusLine: "Payment received",
            })
          } else {
            setSelected(null)
          }
        }
        toast({
          variant: "success",
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

  /** Open Messages; stash book-form context so SMS can link back to booking details. */
  const openInMessages = useCallback(
    (phone: string, bookItem?: LatestCustomerAction | null, draft?: string) => {
      if (bookItem?.event === "book_form") {
        writeBookFormDetailsHandoff(bookItem)
      }
      if (phone.trim()) markSeen(phone)
      setSelected(null)
      // Already in this thread — close the sheet; do not bounce the inbox.
      if (pathname.startsWith("/dashboard/messages")) return
      const qs = new URLSearchParams({ phone })
      const draftText = String(draft ?? "").trim()
      if (draftText) qs.set("draft", draftText)
      router.push(`/dashboard/messages?${qs.toString()}`)
    },
    [markSeen, pathname, router]
  )

  /** Open CRM profile for this phone (secondary action from booking sheet). */
  const openInCrm = useCallback(
    (phone: string) => {
      if (!phone.trim()) return
      setSelected(null)
      router.push(`/dashboard/customers?phone=${encodeURIComponent(phone)}`)
    },
    [router]
  )

  /**
   * Book job — same path as CRM: scheduler job sheet when address + vehicle are ready;
   * otherwise open intake already on the first incomplete step (prefilled).
   */
  const openBookIntake = useCallback(
    (item: LatestCustomerAction) => {
      const phone = (item.customerPhone || "").trim()
      if (!phone) return
      setSelected(null)
      clearBookFormDetailsHandoff()
      // Owner actually booked — drop the leftover from Lines (View does not).
      dismissLatestAlert(item)
      skipAmberLeftoverForItem(item)
      setItems((prev) => prev.filter((row) => row.id !== item.id))
      setSeenTick((n) => n + 1)
      // Resolve calculator id from chip / stored type (AKL chip beats Lockout default).
      const fromKind = serviceQuoteTypeIdFromBookJobKind(item.bookFormJobKind)
      const rawStored = String(item.bookFormServiceQuoteTypeId ?? "").trim()
      const serviceId = (
        fromKind && fromKind !== "lockout"
          ? fromKind
          : rawStored || fromKind || ""
      ) as ServiceQuoteTypeId | ""
      const year = String(item.bookFormVehicleYear ?? "").trim()
      const make = String(item.bookFormVehicleMake ?? "").trim()
      const model = String(item.bookFormVehicleModel ?? "").trim()
      const address = String(item.bookFormAddressLine1 ?? "").trim()
      const addressReady = isSubstantialStreetAddress(address)
      const ymmComplete = Boolean(year && make && model)
      const needsVehicle = serviceId ? serviceTypeRequiresVehicle(serviceId) : true
      const leadId = String(item.bookFormLeadId ?? "").trim()
      // Pool-ready submitted request → same Quote / job sheet CRM Book job uses.
      if (leadId && addressReady && (!needsVehicle || ymmComplete) && serviceId) {
        router.push(buildSchedulerFocusUrl(leadId, { schedule: true }))
        return
      }
      const asapNote =
        item.bookFormUrgency === "asap" ? "Customer urgency: ASAP / emergency" : ""
      const startStep = continueOpenQuoteStep({
        serviceTypeId: serviceId,
        vehicleYear: year,
        vehicleMake: make,
        vehicleModel: model,
        addressReady,
        displayName: item.customerName || "",
      })
      inbound?.openManualCallPanel({
        phoneNumber: phone,
        customerName: item.customerName || undefined,
        leadId: leadId || undefined,
        callStatus: "answered",
        fromBookForm: true,
        // Jump to first incomplete step — do not dump on blank Location.
        continueOpenQuote: true,
        intakeStartStep: startStep,
        serviceQuoteTypeId: serviceId || undefined,
        vehicleYear: year || undefined,
        vehicleMake: make || undefined,
        vehicleModel: model || undefined,
        addressLine1: address || undefined,
        notes: asapNote || undefined,
        quotedPriceCents:
          item.bookFormQuotedPriceCents != null && item.bookFormQuotedPriceCents > 0
            ? item.bookFormQuotedPriceCents
            : undefined,
      })
    },
    [inbound, router, setItems, skipAmberLeftoverForItem]
  )

  /** One-tap unreachable SMS + mark Called · no answer on the lead. */
  const sendUnreachableSms = useCallback(
    async (item: LatestCustomerAction) => {
      const phone = (item.customerPhone || "").trim()
      const leadId = String(item.bookFormLeadId ?? "").trim()
      if (!phone || !leadId) {
        toast({
          title: "Missing phone or lead",
          description: "Open CRM to text this customer.",
          variant: "destructive",
        })
        return
      }
      setBusyJobId(leadId)
      try {
        const res = await fetch(
          `/api/owner/jobs/${encodeURIComponent(leadId)}/callback-outcome`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              outcome: "called_no_answer",
              send_sms: true,
              customer_phone: phone,
              customer_name: item.customerName,
            }),
          }
        )
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          data?: { skipped?: boolean; reason?: string; text?: string }
        }
        if (!res.ok) {
          toast({
            title: "Could not send",
            description: json.error || "Try again from Messages.",
            variant: "destructive",
          })
          return
        }
        if (json.data?.skipped) {
          toast({
            title: "Marked Called · no answer",
            description: "A text was already sent recently — open Messages if you need another.",
          })
          return
        }
        toast({
          title: "Text sent",
          description:
            json.data?.text ||
            buildUnreachableFollowUpSms({ customerName: item.customerName }),
        })
      } catch {
        toast({
          title: "Could not send",
          description: "Check your connection and try again.",
          variant: "destructive",
        })
      } finally {
        setBusyJobId(null)
      }
    },
    [toast]
  )

  /** Reopen booking details from Messages without leaving the text thread. */
  const tryReopenBookFormDetail = useCallback((itemFromEvent?: LatestCustomerAction | null) => {
    const fromEvent = itemFromEvent?.event === "book_form" ? itemFromEvent : null
    if (fromEvent) {
      consumeBookFormReopenPending()
      setSelected(fromEvent)
      return
    }
    // Navigation fallback — only if Messages asked us to reopen (pending flag).
    if (!consumeBookFormReopenPending()) return
    const item = peekBookFormDetailsHandoff()
    if (!item || item.event !== "book_form") return
    setSelected(item)
  }, [])

  useEffect(() => {
    // Lines tab visible again after Messages handoff.
    tryReopenBookFormDetail()
  }, [pathname, tryReopenBookFormDetail])

  useEffect(() => {
    // Same-tab signal when Lines is already mounted under the presence host.
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<LatestCustomerAction>).detail
      tryReopenBookFormDetail(detail)
    }
    window.addEventListener(LYNCR_REOPEN_BOOK_FORM_DETAIL_EVENT, onOpen)
    return () => {
      window.removeEventListener(LYNCR_REOPEN_BOOK_FORM_DETAIL_EVENT, onOpen)
    }
  }, [tryReopenBookFormDetail])

  // Re-filter when returning to the tab or when Messages marks a thread seen.
  useEffect(() => {
    const bump = () => setSeenTick((n) => n + 1)
    window.addEventListener("focus", bump)
    window.addEventListener(LATEST_SEEN_CHANGED_EVENT, bump)
    return () => {
      window.removeEventListener("focus", bump)
      window.removeEventListener(LATEST_SEEN_CHANGED_EVENT, bump)
    }
  }, [])

  // Empty settled → hide Alerts (CallFlow min-h absorbs the gap — no fake gray card).
  if (items.length === 0 && !selected) {
    if (loading) {
      return (
        <div className="mt-3 w-full text-left" aria-hidden data-flicker-probe="lines-alerts-loading">
          <div className="mb-2 h-5 w-14 rounded bg-muted/25" />
          <div className="h-[4.75rem] rounded-xl border border-border/50 bg-muted/10" />
        </div>
      )
    }
    return null
  }

  return (
    <>
      {items.length > 0 ? (
        // mt-3 only when Alerts actually paint — keeps Primary→Available gap honest when empty.
        <div className="mt-3 w-full text-left" aria-label="Alerts">
          {/* Tiny header only — alert cards carry the meaning. */}
          <div className="mb-2 flex items-center gap-2 px-0.5">
            <p
              className={
                compact
                  ? LINES_MOBILE_SECTION_LABEL
                  : "text-micro font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              }
            >
              Alerts
            </p>
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500/25 px-2 text-micro font-bold tabular-nums text-orange-100 ring-1 ring-orange-400/40"
              aria-label={`${items.length} alert${items.length === 1 ? "" : "s"}`}
            >
              {items.length}
            </span>
          </div>

          <ul className="space-y-2">
            {items.map((item) => {
              const isJob = item.event === "job_finished"
              const isPaid = item.event === "customer_paid"
              const isBook = item.event === "book_form"
              // Replies in this list are unread by definition (read ones were filtered out).
              const unread = item.event === "replied"
              return (
                <li key={item.id}>
                  <div
                    className={cn(
                      "flex w-full items-center gap-2 rounded-xl border px-3 py-3 text-left transition-colors transition-shadow duration-700",
                      isPaid
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : isBook
                          ? "border-orange-500/45 bg-orange-500/10"
                          : isJob
                            ? "border-amber-500/40 bg-amber-500/10"
                            : unread
                              ? "border-sky-400/45 bg-sky-500/15 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.12)]"
                              : "border-sky-500/25 bg-sky-500/5",
                      // New-arrival pulse — fades out over 700ms once useRecentArrivals expires the id.
                      recentItemIds.has(item.id) && "ring-2 ring-sky-400/70"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        // Opening counts as read → leaves Latest (except job_finished).
                        openDetail(item)
                      }}
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
                      ) : isPaid ? (
                        <span
                          className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400"
                          aria-hidden
                        />
                      ) : isBook ? (
                        <span
                          className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-orange-400"
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
                          <span className="shrink-0 text-micro tabular-nums text-muted-foreground">
                            {formatTimeAgo(item.at)}
                          </span>
                        </div>
                        <p
                          className={cn(
                            "mt-0.5 truncate text-xs font-semibold",
                            isPaid
                              ? "text-emerald-200"
                              : isBook
                                ? "text-orange-200"
                                : isJob
                                  ? "text-amber-200"
                                  : unread
                                    ? "text-sky-200"
                                    : "text-sky-300/80"
                          )}
                        >
                          {item.statusLine}
                        </p>
                        {item.preview ? (
                          <p className="mt-1 truncate text-2xs text-muted-foreground">{item.preview}</p>
                        ) : null}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                    {item.event === "replied" && item.customerPhone ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openInMessages(item.customerPhone)
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-2xs font-bold text-sky-100 hover:bg-sky-500/25"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Reply
                      </button>
                    ) : null}
                    {isBook ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          // Same as tapping the row — open booking details (not new intake).
                          openDetail(item)
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-orange-500/45 bg-orange-500/15 px-3 py-2 text-2xs font-bold text-orange-100 hover:bg-orange-500/25"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View booking
                      </button>
                    ) : null}
                    {isPaid && item.thanksReviewPending && item.completedJobId ? (
                      // Same customer paid + still needs thanks — one card, primary Send.
                      <button
                        type="button"
                        disabled={busyJobId === item.completedJobId}
                        onClick={(e) => {
                          e.stopPropagation()
                          void sendThanksReview(item.completedJobId!)
                        }}
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-2xs font-bold disabled:opacity-50",
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
                        {failedReviewJobIds.has(item.completedJobId) ? "Retry" : "Send thanks"}
                      </button>
                    ) : isPaid ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          // Payment already received — open read-only detail, not Collect.
                          openDetail(item)
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-3 py-2 text-2xs font-bold text-emerald-100 hover:bg-emerald-500/25"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View
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
                          "inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-2xs font-bold disabled:opacity-50",
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
                    {/* Clear — hide without opening (stale SMS, done-for-now thanks, etc.). */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        dismissLatestAlert(item)
                        skipAmberLeftoverForItem(item)
                        // Drop from live list + rewrite paint cookie (same as open/seen).
                        setItems((prev) => prev.filter((row) => row.id !== item.id))
                        setSeenTick((n) => n + 1)
                        if (selected?.id === item.id) setSelected(null)
                      }}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      aria-label={`Clear alert for ${item.customerName || "customer"}`}
                      title="Clear"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {/* Mount Sheet only while open — always-mounted Radix Sheet+Close button
          contributed to update-depth crashes when Latest refreshed (#185).
          Compact bottom sheet (content height) — not a sparse full-screen drawer. */}
      {selected ? (
        <Sheet open onOpenChange={(open) => !open && setSelected(null)}>
          <SheetContent
            side="bottom"
            className={cn(
              // Hug content; cap tall Needs-reply threads so the sheet never fills the viewport.
              "flex h-auto max-h-[min(85dvh,40rem)] flex-col gap-0 overflow-hidden rounded-t-2xl border-border bg-[#101018] p-0",
              "sm:mx-auto sm:max-w-lg",
              "pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
            )}
          >
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
              onOpenBookIntake={openBookIntake}
              onCallBookForm={(it) => {
                // Tapping Call counts as handling the leftover — drop it from Lines.
                dismissLatestAlert(it)
                skipAmberLeftoverForItem(it)
                setItems((prev) => prev.filter((row) => row.id !== it.id))
                setSeenTick((n) => n + 1)
                setSelected(null)
              }}
              onSendUnreachable={(it) => void sendUnreachableSms(it)}
              onOpenCrm={openInCrm}
            />
          </SheetContent>
        </Sheet>
      ) : null}
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
  onOpenBookIntake,
  onSendUnreachable,
  onOpenCrm,
  onCallBookForm,
}: {
  item: LatestCustomerAction
  organizationId: string | null
  busyJobId: string | null
  markingOpened: boolean
  sendFailed: boolean
  onSendThanks: (jobId: string) => void
  onMarkReviewOpened: (jobId: string) => void
  onOpenMessages: (phone: string, bookItem?: LatestCustomerAction | null, draft?: string) => void
  onOpenJob: (jobId: string) => void
  onOpenBookIntake: (item: LatestCustomerAction) => void
  onSendUnreachable: (item: LatestCustomerAction) => void
  onOpenCrm: (phone: string) => void
  onCallBookForm: (item: LatestCustomerAction) => void
}) {
  // Toast for send / cancel / suggest feedback inside this sheet.
  const { toast } = useToast()
  const phoneLabel = item.customerPhone
    ? formatPhoneDisplay(item.customerPhone) || item.customerPhone
    : "No phone on file"
  const needsReviewSend =
    Boolean(item.completedJobId) &&
    (item.event === "job_finished" || Boolean(item.thanksReviewPending))
  // Full SMS history for reply detail; also when a finished job already has an inbound text.
  const showSmsThread =
    (item.event === "replied" ||
      (item.event === "job_finished" && Boolean(item.lastInbound))) &&
    Boolean(item.customerPhone?.trim())
  const isPaidEvent = item.event === "customer_paid"
  const isBookEvent = item.event === "book_form"
  // Inline reply composer + chips whenever this sheet shows a customer text to answer.
  const showInlineReply = showSmsThread
  // Post-job follow-up chips (no inbound yet) — compact alternatives above CTAs.
  const showJobFinishedChips =
    (item.event === "job_finished" || Boolean(item.thanksReviewPending)) &&
    !showInlineReply &&
    Boolean(item.customerPhone?.trim())
  // tel: link for one-tap call from the booking sheet.
  const telHref = item.customerPhone ? buildTelHref(item.customerPhone) : null
  // Submitted fields for book-form / book-from-hold (front and center).
  const bookService = isBookEvent ? bookFormServiceLabel(item) : ""
  const bookVehicle = isBookEvent ? bookFormVehicleLabel(item) : ""
  const bookAddress = isBookEvent
    ? String(item.bookFormAddressLine1 ?? "").trim()
    : ""
  const bookWhen =
    isBookEvent && item.bookFormUrgency === "asap"
      ? "ASAP / emergency"
      : isBookEvent
        ? "Preferred window"
        : ""
  // Simple delivery / open status when 119 columns are present on the last outbound.
  const reviewDeliveryLabel = item.lastOutbound
    ? formatSmsDeliveryLabel({ ...item.lastOutbound, direction: "outbound" })
    : null
  const [threadMessages, setThreadMessages] = useState<SmsMessage[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadError, setThreadError] = useState<string | null>(null)
  const threadBottomRef = useRef<HTMLDivElement | null>(null)

  // --- Inline reply composer (Needs reply) ---
  // Draft text the owner will send (chips / AI fill this; Send posts it).
  const [replyDraft, setReplyDraft] = useState("")
  // True while POST /api/messaging/send is in flight.
  const [replySending, setReplySending] = useState(false)
  // True while POST /api/messaging/suggest-reply is in flight.
  const [suggestLoading, setSuggestLoading] = useState(false)
  // AI / heuristic draft options shown under Suggest reply (tap to fill composer).
  const [aiDrafts, setAiDrafts] = useState<string[]>([])
  // Business name for chip copy (session + outbound prefix).
  const [businessName, setBusinessName] = useState("")
  // Linked open lead/job id for soft “Mark cancelled” (cancel intent only).
  const [cancelJobId, setCancelJobId] = useState<string | null>(null)
  // True while PATCH status=cancelled runs.
  const [cancellingJob, setCancellingJob] = useState(false)
  // Hide Mark cancelled after success.
  const [cancelDone, setCancelDone] = useState(false)

  const orgId =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : null

  // Last inbound body for chips / intent (prefer live thread, else Latest snapshot).
  const lastInboundBody = useMemo(() => {
    const fromThread = [...threadMessages].reverse().find((m) => m.direction === "inbound")
    return (fromThread?.body || item.lastInbound?.body || "").trim()
  }, [threadMessages, item.lastInbound?.body])

  // Last outbound for vehicle / business extraction.
  const lastOutboundBody = useMemo(() => {
    const fromThread = [...threadMessages].reverse().find((m) => m.direction === "outbound")
    return (fromThread?.body || item.lastOutbound?.body || "").trim()
  }, [threadMessages, item.lastOutbound?.body])

  // Rule-based chips (instant — no network).
  const replySuggest = useMemo(() => {
    if (!showInlineReply || !lastInboundBody) {
      return {
        intent: "generic" as SmsReplyIntent,
        chips: [] as SmsReplyChip[],
        drafts: [] as string[],
      }
    }
    return buildHeuristicSmsReplySuggestions({
      customerMessage: lastInboundBody,
      customerName: item.customerName,
      businessName:
        businessName ||
        extractBusinessNameFromSmsBody(lastOutboundBody) ||
        null,
      vehicle: extractVehicleFromSmsBody(lastOutboundBody),
      priorOutbound: lastOutboundBody || null,
    })
  }, [
    showInlineReply,
    lastInboundBody,
    lastOutboundBody,
    item.customerName,
    businessName,
  ])

  // Compact post-job SMS chips (opens Messages with draft — does not send).
  const jobFinishedChips = useMemo(() => {
    if (!showJobFinishedChips) return [] as SmsReplyChip[]
    return buildJobFinishedFollowUpChips({
      customerName: item.customerName,
      businessName:
        businessName ||
        extractBusinessNameFromSmsBody(lastOutboundBody) ||
        null,
    })
  }, [showJobFinishedChips, item.customerName, businessName, lastOutboundBody])

  // Cancel / declined intent → soft Mark cancelled CTA when we find a job.
  const showCancelAction =
    showInlineReply && replySuggest.intent === "cancel" && !cancelDone

  // Load business name once for chip sign-offs (Needs reply + job-finished follow-ups).
  useEffect(() => {
    if (!showInlineReply && !showJobFinishedChips) return
    let cancelled = false
    void fetch("/api/auth/session", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: { user?: { business_name?: string } } } | null) => {
        if (cancelled) return
        setBusinessName(String(json?.data?.user?.business_name ?? "").trim())
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [showInlineReply, showJobFinishedChips])

  // When cancel intent, look up an open job/lead for this phone.
  useEffect(() => {
    if (!showCancelAction || !item.customerPhone) {
      setCancelJobId(null)
      return
    }
    let cancelled = false
    const qs = new URLSearchParams({ phone: item.customerPhone })
    if (orgId) qs.set("organization_id", orgId)
    void fetch(`/api/owner/scheduler/lookup?${qs}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (json: {
          data?: {
            pool?: { id: string; dispatch_status?: string | null }[]
            scheduled?: { id: string; job_status?: string | null }[]
          }
        } | null) => {
          if (cancelled || !json?.data) return
          const terminal = (s: string | null | undefined) => {
            const t = String(s ?? "").toLowerCase()
            return (
              t === "completed" ||
              t === "cancelled" ||
              t === "canceled" ||
              t === "referred" ||
              t === "unresolved"
            )
          }
          const scheduledOpen = (json.data.scheduled ?? []).find(
            (j) => j.id && !terminal(j.job_status)
          )
          const poolOpen = (json.data.pool ?? []).find(
            (j) => j.id && !terminal(j.dispatch_status)
          )
          setCancelJobId(scheduledOpen?.id || poolOpen?.id || null)
        }
      )
      .catch(() => {
        if (!cancelled) setCancelJobId(null)
      })
    return () => {
      cancelled = true
    }
  }, [showCancelAction, item.customerPhone, orgId])

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

  // Reset composer when switching to another alert.
  useEffect(() => {
    setReplyDraft("")
    setAiDrafts([])
    setCancelDone(false)
    setCancelJobId(null)
  }, [item.id])

  /** Send the composer draft via the same Messages send API. */
  async function sendInlineReply() {
    const text = replyDraft.trim()
    const to = item.customerPhone?.trim()
    if (!text || !to || replySending) return
    setReplySending(true)
    try {
      const res = await fetch("/api/messaging/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          text,
          organization_id: orgId || undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { message?: SmsMessage | null; delivery_warning?: string | null }
      }
      if (!res.ok) throw new Error(json.error || "Could not send message")
      // Append optimistic bubble so the thread updates without leaving the sheet.
      if (json.data?.message) {
        setThreadMessages((prev) => [...prev, json.data!.message!])
      }
      setReplyDraft("")
      setAiDrafts([])
      toast({
        title: "SMS sent",
        description: json.data?.delivery_warning || "Reply delivered to Messages inbox.",
      })
    } catch (e) {
      toast({
        title: "SMS failed",
        description: e instanceof Error ? e.message : "Could not send the text.",
        variant: "destructive",
      })
    } finally {
      setReplySending(false)
    }
  }

  /** Call Suggest reply — fills drafts list; never auto-sends. */
  async function suggestReply() {
    if (!lastInboundBody || suggestLoading) return
    setSuggestLoading(true)
    setAiDrafts([])
    try {
      const res = await fetch("/api/messaging/suggest-reply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_message: lastInboundBody,
          customer_name: item.customerName,
          business_name: businessName || undefined,
          prior_outbound: lastOutboundBody || undefined,
          vehicle: extractVehicleFromSmsBody(lastOutboundBody) || undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { drafts?: string[] }
      }
      if (!res.ok) throw new Error(json.error || "Could not suggest a reply")
      const drafts = Array.isArray(json.data?.drafts) ? json.data!.drafts! : []
      // Prefer API drafts; fall back to local heuristic drafts.
      const next =
        drafts.filter((d) => d.trim()).length > 0
          ? drafts.filter((d) => d.trim())
          : replySuggest.drafts
      setAiDrafts(next)
      // Put the first draft in the composer so they can edit + Send.
      if (next[0]) setReplyDraft(next[0])
    } catch (e) {
      // Offline / no key path: still fill from local chips/drafts.
      if (replySuggest.drafts[0]) {
        setAiDrafts(replySuggest.drafts)
        setReplyDraft(replySuggest.drafts[0])
        toast({
          title: "Using quick drafts",
          description: e instanceof Error ? e.message : "AI unavailable — rule-based draft loaded.",
        })
      } else {
        toast({
          title: "Suggest failed",
          description: e instanceof Error ? e.message : "Could not suggest a reply.",
          variant: "destructive",
        })
      }
    } finally {
      setSuggestLoading(false)
    }
  }

  /** Soft cancel linked lead/job when customer said they no longer need service. */
  async function markLinkedCancelled() {
    if (!cancelJobId || cancellingJob) return
    setCancellingJob(true)
    try {
      const res = await fetch(
        `/api/owner/jobs/${encodeURIComponent(cancelJobId)}/status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "cancelled" }),
        }
      )
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error || "Could not cancel job")
      setCancelDone(true)
      setCancelJobId(null)
      toast({ title: "Marked cancelled", description: "Linked job/lead set to cancelled." })
    } catch (e) {
      toast({
        title: "Could not cancel",
        description: e instanceof Error ? e.message : "Try Open job instead.",
        variant: "destructive",
      })
    } finally {
      setCancellingJob(false)
    }
  }

  const steps: Array<{ label: string; done: boolean; detail?: string }> = []
  if (item.event === "customer_paid") {
    steps.push({
      label: "Customer paid",
      done: true,
      detail: formatTimeAgo(item.at),
    })
    if (item.paidAmountCents != null && item.paidAmountCents > 0) {
      steps.push({
        label: "Amount",
        done: true,
        detail: (item.paidAmountCents / 100).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: item.paidAmountCents % 100 === 0 ? 0 : 2,
        }),
      })
    }
    if (item.thanksReviewPending) {
      steps.push({
        label: "Thanks + review text",
        done: false,
        detail: sendFailed
          ? "Failed — tap Retry below"
          : "Not sent yet — use the button below",
      })
    }
  }
  // Book-form rows use a dedicated “Submitted request” block — skip status chips.
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
      // Point owners at the inline composer (not Messages-only).
      detail: "Reply below — or open Messages",
    })
  }

  return (
    <div className="flex min-h-0 flex-col">
      {/* Mobile drag affordance — matches Map / Scheduler sheets. */}
      <div className="flex shrink-0 justify-center pb-0.5 pt-3 md:hidden" aria-hidden>
        <div className="h-1 w-10 rounded-full bg-zinc-600/80" />
      </div>

      <SheetHeader className="shrink-0 border-b border-border/80 px-4 pb-3 pt-2 text-left">
        {isBookEvent ? (
          <>
            {/* Booking sheet: title = what happened; name/phone are submitted fields. */}
            <SheetTitle className="pr-8 text-base font-semibold text-foreground">
              Booking request
            </SheetTitle>
            <p className="mt-1 text-sm font-medium text-orange-100">{item.headline}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Submitted {formatTimeAgo(item.at)}
            </p>
          </>
        ) : (
          <>
            <SheetTitle className="pr-8 text-base font-semibold text-foreground">
              {item.customerName}
            </SheetTitle>
            <p className="text-sm text-muted-foreground">{phoneLabel}</p>
            <p className="mt-1 text-sm font-medium text-foreground">{item.headline}</p>
          </>
        )}
        {item.event === "replied" ? (
          <p className="mt-1 text-xs font-semibold text-sky-300">Needs reply</p>
        ) : null}
        {item.reviewLinkOpened ? (
          <p className="mt-1 text-xs font-semibold text-emerald-300">Opened</p>
        ) : reviewDeliveryLabel ? (
          <p
            className={cn(
              "mt-1 text-xs font-semibold",
              reviewDeliveryLabel === "Failed" ? "text-rose-300" : "text-muted-foreground"
            )}
          >
            {reviewDeliveryLabel}
          </p>
        ) : null}
      </SheetHeader>

      {/* Content hugs height — no flex-1 empty middle. Scroll only when needed. */}
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
        {isBookEvent ? (
          // Submitted fields front and center — not buried in “Continue intake”.
          <section className="rounded-xl border border-orange-500/30 bg-orange-500/5 px-3 py-3">
            <p className="text-micro font-semibold uppercase tracking-[0.12em] text-orange-200/90">
              Customer booked
            </p>
            <dl className="mt-2 space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">Name</dt>
                <dd className="min-w-0 font-medium text-foreground">{item.customerName}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">Phone</dt>
                <dd className="min-w-0 text-foreground">{phoneLabel}</dd>
              </div>
              {bookService ? (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">Service</dt>
                  <dd className="min-w-0 font-medium text-foreground">{bookService}</dd>
                </div>
              ) : null}
              {bookVehicle ? (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">Vehicle</dt>
                  <dd className="min-w-0 text-foreground">{bookVehicle}</dd>
                </div>
              ) : null}
              {bookAddress ? (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">Address</dt>
                  <dd className="min-w-0 text-foreground">{bookAddress}</dd>
                </div>
              ) : null}
              {bookWhen ? (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">When</dt>
                  <dd className="min-w-0 text-foreground">{bookWhen}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : (
          <section>
            <p className="text-micro font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Status
            </p>
            <ul className="mt-1.5 space-y-2">
              {steps.map((step) => (
                <li
                  key={step.label}
                  className={cn(
                    "rounded-xl border px-3 py-2",
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
                          : "text-muted-foreground"
                    )}
                  >
                    {step.done ? "✓ " : "○ "}
                    {step.label}
                  </p>
                  {step.detail ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )}

        {showSmsThread ? (
          <section>
            <p className="text-micro font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Conversation
            </p>
            {threadLoading ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading messages…
              </div>
            ) : threadError ? (
              <p className="mt-2 text-xs text-rose-300">{threadError}</p>
            ) : threadMessages.length === 0 ? (
              // Fallback: still show last pair from Latest if the feed is empty.
              <div className="mt-2 space-y-2">
                {item.lastOutbound ? (
                  <div>
                    <p className="text-micro font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Your text
                    </p>
                    <p className="mt-1 whitespace-pre-wrap rounded-xl border border-border/60 bg-card/60 px-3 py-2 text-sm text-foreground">
                      {item.lastOutbound.body}
                    </p>
                  </div>
                ) : null}
                {item.lastInbound ? (
                  <div>
                    <p className="text-micro font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Their reply
                    </p>
                    <p className="mt-1 whitespace-pre-wrap rounded-xl border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-sm font-medium text-foreground">
                      {item.lastInbound.body}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-1.5 max-h-[min(32dvh,14rem)] space-y-2 overflow-y-auto rounded-xl border border-border/50 bg-muted/10 px-3 py-3">
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
                          "max-w-[88%] rounded-2xl px-4 py-2 text-sm leading-snug",
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
                            "mt-1 text-micro tabular-nums",
                            outbound ? "text-emerald-100/80" : "text-muted-foreground",
                            outbound && msg.status === "failed" && "text-rose-100/90"
                          )}
                        >
                          {formatMessageTime(msg.created_at)}
                          {deliveryLabel ? ` · ${deliveryLabel}` : ""}
                        </p>
                        {outbound && msg.status === "failed" && msg.delivery_error ? (
                          <p className="mt-0.5 text-micro leading-snug text-rose-100/80">
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

      <div className="shrink-0 space-y-2 border-t border-border/80 px-4 pt-3">
        {/* Payment-received alerts are informational — no Collect CTA. */}
        {isPaidEvent ? (
          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-center text-sm font-semibold text-emerald-100">
            Paid · no balance to collect
          </p>
        ) : null}
        {isBookEvent ? (
          <>
            {/* Primary: Book job — same destination as CRM when the form is complete. */}
            <button
              type="button"
              onClick={() => onOpenBookIntake(item)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-zinc-950 hover:bg-orange-400"
            >
              <CalendarCheck className="h-4 w-4" />
              Book job
            </button>
            {/* Secondary: Call + couldn’t-reach text. */}
            <div className="grid grid-cols-2 gap-2">
              {telHref ? (
                <a
                  href={telHref}
                  onClick={() => onCallBookForm(item)}
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-border/60 bg-muted/20 px-2 py-2 text-2xs font-semibold text-foreground hover:bg-muted/40"
                >
                  <Phone className="h-3.5 w-3.5" />
                  Call
                </a>
              ) : (
                <span className="inline-flex items-center justify-center gap-1 rounded-xl border border-border/40 bg-muted/10 px-2 py-2 text-2xs font-semibold text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  Call
                </span>
              )}
              <button
                type="button"
                onClick={() => onSendUnreachable(item)}
                disabled={
                  !item.customerPhone ||
                  !item.bookFormLeadId ||
                  busyJobId === item.bookFormLeadId
                }
                className="inline-flex items-center justify-center gap-1 rounded-xl border border-amber-500/35 bg-amber-500/10 px-2 py-2 text-2xs font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-40"
              >
                {busyJobId === item.bookFormLeadId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MessageSquare className="h-3.5 w-3.5" />
                )}
                Couldn’t reach — text
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => item.customerPhone && onOpenCrm(item.customerPhone)}
                disabled={!item.customerPhone}
                className="inline-flex items-center justify-center gap-1 rounded-xl border border-border/60 bg-muted/20 px-2 py-2 text-2xs font-semibold text-foreground hover:bg-muted/40 disabled:opacity-40"
              >
                <UserRound className="h-3.5 w-3.5" />
                CRM
              </button>
              <button
                type="button"
                onClick={() =>
                  item.customerPhone && onOpenMessages(item.customerPhone, item)
                }
                disabled={!item.customerPhone}
                className="inline-flex items-center justify-center gap-1 rounded-xl border border-sky-500/30 bg-sky-500/10 px-2 py-2 text-2xs font-semibold text-sky-200 hover:bg-sky-500/20 disabled:opacity-40"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Messages
              </button>
            </div>
          </>
        ) : null}
        {item.customerPhone && !isPaidEvent && !isBookEvent && showInlineReply ? (
          <div className="space-y-2">
            {/* Quick reply chips — tap fills composer (does not send). */}
            {replySuggest.chips.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {replySuggest.chips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setReplyDraft(chip.body)}
                    className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-2xs font-semibold text-sky-100 hover:bg-sky-500/20"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            ) : null}

            {/* Suggest reply → AI or rule-based drafts (still requires Send). */}
            <button
              type="button"
              onClick={() => void suggestReply()}
              disabled={suggestLoading || !lastInboundBody}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-500/20 disabled:opacity-50"
            >
              {suggestLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Suggest reply
            </button>

            {/* Extra AI draft options if Suggest returned more than one. */}
            {aiDrafts.length > 1 ? (
              <div className="space-y-2">
                {aiDrafts.map((draft, idx) => (
                  <button
                    key={`ai-draft-${idx}`}
                    type="button"
                    onClick={() => setReplyDraft(draft)}
                    className="w-full rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-left text-2xs leading-snug text-foreground hover:bg-muted/40"
                  >
                    {draft}
                  </button>
                ))}
              </div>
            ) : null}

            {/* Composer + Send — primary CTA stays on this sheet. */}
            <div className="rounded-xl border border-border/60 bg-muted/15 p-2">
              <textarea
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                rows={2}
                placeholder="Type a reply…"
                className="w-full resize-none bg-transparent px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void sendInlineReply()}
                disabled={replySending || !replyDraft.trim()}
                className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-zinc-950 hover:bg-sky-400 disabled:opacity-50"
              >
                {replySending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send SMS
              </button>
            </div>

            {/* Optional: mark linked job cancelled when customer declined. */}
            {showCancelAction && cancelJobId ? (
              <button
                type="button"
                onClick={() => void markLinkedCancelled()}
                disabled={cancellingJob}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border/35 bg-zinc-500/10 px-4 py-2 text-xs font-semibold text-foreground hover:bg-zinc-500/20 disabled:opacity-50"
              >
                {cancellingJob ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                Mark cancelled
              </button>
            ) : null}

            {/* Secondary: full Messages inbox (unchanged destination). */}
            <button
              type="button"
              onClick={() => onOpenMessages(item.customerPhone)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted/40"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Open in Messages
            </button>
          </div>
        ) : null}

        {/* Job finished: compact follow-up chips above primary Send thanks CTA. */}
        {showJobFinishedChips && jobFinishedChips.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {jobFinishedChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => onOpenMessages(item.customerPhone!, undefined, chip.body)}
                className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-2xs font-semibold text-sky-100 hover:bg-sky-500/20"
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}

        {/* Primary for job finished (or paid+thanks still pending): Send thanks + review. */}
        {item.completedJobId &&
        (item.event !== "customer_paid" || item.thanksReviewPending) ? (
          <button
            type="button"
            disabled={busyJobId === item.completedJobId}
            onClick={() => onSendThanks(item.completedJobId!)}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-50",
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

        {item.customerPhone && !isPaidEvent && !isBookEvent && !showInlineReply ? (
          <button
            type="button"
            onClick={() => onOpenMessages(item.customerPhone)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-sky-500/35 bg-sky-500/10 px-4 py-3 text-sm font-semibold text-sky-200 hover:bg-sky-500/20"
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
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
          >
            {markingOpened ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Star className="h-4 w-4" />
            )}
            Mark review received
          </button>
        ) : null}
        {/* Same JobDetailDrawer as Scheduler / CRM View job (Complete + Send review live there too). */}
        {item.completedJobId ? (
          <button
            type="button"
            onClick={() => onOpenJob(item.completedJobId!)}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold",
              // Paid detail: Open job is primary only when thanks already handled.
              isPaidEvent && !item.thanksReviewPending
                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                : "border border-border/60 text-foreground hover:bg-muted/40"
            )}
          >
            {isPaidEvent && !item.thanksReviewPending ? <Eye className="h-4 w-4" /> : null}
            {isPaidEvent && !item.thanksReviewPending ? "View job" : "Open job"}
          </button>
        ) : null}
      </div>
    </div>
  )
}
