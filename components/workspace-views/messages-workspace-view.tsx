"use client"

// Owner Messages inbox — thread list + conversation + reply (polls GET /api/messaging).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ClipboardList, Loader2, MessageSquare, Send, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import {
  WorkspacePage,
  WorkspacePanel,
  MOBILE_PANEL_VIEWPORT_MIN_H,
} from "@/components/dashboard-workspace-ui"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  bookFormHandoffMatchesPhone,
  peekBookFormDetailsHandoff,
  requestReopenBookFormDetail,
} from "@/lib/book-form-details-handoff"
import { buildTelHref } from "@/lib/phone-e164"
import { usePollBudget } from "@/lib/hooks/use-poll-budget"
import { markLatestReplySeen } from "@/lib/latest-seen"
import { formatSmsDeliveryLabel } from "@/lib/sms-delivery-labels"
import { useSessionSeed } from "@/lib/hooks/use-client-seed"
import { MessagesThreadListSkeleton } from "@/components/workspace-content-skeletons"
import {
  ClientSearchParamsBridge,
  readWindowSearchQuery,
  searchQueryToParams,
} from "@/components/client-search-params-bridge"
import {
  phoneMatchKey,
  resolveMessagesDeepLinkPhone,
  shouldApplyMessagesDeepLink,
} from "@/lib/messages-deep-link"
import {
  buildHeuristicSmsReplySuggestions,
  extractBusinessNameFromSmsBody,
  extractVehicleFromSmsBody,
  type SmsReplyChip,
  type SmsReplyIntent,
} from "@/lib/sms-reply-suggestions"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"
import type { SmsMessage } from "@/lib/types"

const EMPTY_MESSAGES: SmsMessage[] = []

function messagesCacheKey(orgId: string | null): string {
  return persistedCacheKey("messages-inbox", orgId ?? "default")
}

function readMessagesCache(orgId: string | null): SmsMessage[] {
  const cached = readPersistedCache<{ messages: SmsMessage[] }>(messagesCacheKey(orgId))
  if (!cached || !Array.isArray(cached.messages)) return EMPTY_MESSAGES
  return cached.messages
}

type SmsThread = {
  customerPhone: string
  messages: SmsMessage[]
  lastMessage: SmsMessage
  needsReply: boolean
}

function formatOutboundDeliveryLabel(msg: SmsMessage): string | null {
  return formatSmsDeliveryLabel(msg)
}

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

function groupIntoThreads(messages: SmsMessage[]): SmsThread[] {
  // Group by last-10 digits so +1… / local formats stay one conversation.
  const byKey = new Map<string, { displayPhone: string; list: SmsMessage[] }>()
  for (const msg of messages) {
    const raw = (msg.customer_phone?.trim() || msg.from_number || "").trim()
    if (!raw) continue
    const key = phoneMatchKey(raw)
    const mapKey = key.length >= 10 ? key : raw
    const existing = byKey.get(mapKey)
    if (existing) {
      existing.list.push(msg)
      // Prefer E.164-ish display when we see a longer/normalized value.
      if (raw.startsWith("+") && !existing.displayPhone.startsWith("+")) {
        existing.displayPhone = raw
      }
    } else {
      byKey.set(mapKey, { displayPhone: raw, list: [msg] })
    }
  }

  const threads: SmsThread[] = []
  for (const { displayPhone, list } of byKey.values()) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    const lastMessage = sorted[sorted.length - 1]
    if (!lastMessage) continue
    threads.push({
      customerPhone: displayPhone,
      messages: sorted,
      lastMessage,
      needsReply: lastMessage.direction === "inbound",
    })
  }

  threads.sort(
    (a, b) =>
      new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
  )
  return threads
}

const MessagesWorkspaceViewInner = memo(function MessagesWorkspaceViewInner({
  // Presence host keeps this pane mounted after first visit — only scroll/poll when visible.
  isActive = true,
  urlQuery,
}: {
  isActive?: boolean
  // Live URL query from ClientSearchParamsBridge (does not suspend this pane).
  urlQuery: string
}) {
  const { activeOrganizationId, organizations } = useDashboardWorkspace()
  // Parse ?phone= / ?draft= without useSearchParams() remounting Messages on tab click.
  const searchParams = useMemo(() => searchQueryToParams(urlQuery), [urlQuery])
  const router = useRouter()
  // Pause when Messages pane OR browser tab is hidden.
  const pollEnabled = usePollBudget(isActive)
  const orgId =
    activeOrganizationId && !activeOrganizationId.startsWith("legacy-")
      ? activeOrganizationId
      : null
  // Workspace / org name for chip sign-offs (falls back to outbound “Name — …” prefix).
  const workspaceBusinessName =
    organizations.find((o) => o.id === activeOrganizationId)?.name?.trim() ||
    organizations[0]?.name?.trim() ||
    ""

  const cachedMessages = useSessionSeed(
    () => readMessagesCache(orgId),
    EMPTY_MESSAGES,
    orgId ?? "default"
  )
  const [liveMessages, setLiveMessages] = useState<SmsMessage[] | null>(null)
  const messages = liveMessages ?? cachedMessages
  // Spinner only on cold cache — seeded inbox paints immediately on revisit.
  const [loading, setLoading] = useState(() => cachedMessages.length === 0)
  const [error, setError] = useState<string | null>(null)
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // True while POST /api/messaging/suggest-reply is in flight.
  const [suggestLoading, setSuggestLoading] = useState(false)
  // Extra draft options from Suggest reply (tap fills composer — never auto-sends).
  const [aiDrafts, setAiDrafts] = useState<string[]>([])
  // Optional CRM display name for friendlier chip copy (loaded when a thread opens).
  const [customerName, setCustomerName] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  // Scroll the message list only — never the whole page (avoids jumping shared <main>).
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  // Last `?phone=` key we opened — blocks poll/refetch from re-applying a stale deep link.
  const appliedDeepLinkKeyRef = useRef<string | null>(null)
  const threadOpen = Boolean(selectedPhone)

  /** Drop phone/draft query params so refetch cannot yank the open thread. */
  const clearMessagesDeepLinkUrl = useCallback(() => {
    const hasPhone = searchParams.get("phone")
    const hasDraft = searchParams.get("draft")
    if (!hasPhone && !hasDraft) return
    router.replace("/dashboard/messages", { scroll: false })
  }, [router, searchParams])

  const hasPaintedMessagesRef = useRef(false)
  if (messages.length > 0) hasPaintedMessagesRef.current = true

  useEffect(() => {
    if (cachedMessages.length > 0) {
      hasPaintedMessagesRef.current = true
      setLoading(false)
    }
  }, [cachedMessages.length])

  const loadMessages = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? hasPaintedMessagesRef.current
      if (!silent) setLoading(true)
      setError(null)
      try {
        const qs = orgId
          ? `?organization_id=${encodeURIComponent(orgId)}&limit=200`
          : "?limit=200"
        const res = await fetch(`/api/messaging${qs}`, {
          credentials: "include",
          cache: "no-store",
        })
        const json = (await res.json()) as {
          error?: string
          data?: { messages?: SmsMessage[] }
        }
        if (!res.ok) throw new Error(json.error || "Could not load messages")
        const next = Array.isArray(json.data?.messages) ? json.data!.messages! : []
        setLiveMessages(next)
        writePersistedCache(messagesCacheKey(orgId), { messages: next })
        hasPaintedMessagesRef.current = true
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load messages")
      } finally {
        setLoading(false)
      }
    },
    [orgId]
  )

  // Org switch — drop live override so the matching seed can show.
  useEffect(() => {
    setLiveMessages(null)
    const seeded = readMessagesCache(orgId).length > 0
    hasPaintedMessagesRef.current = seeded
    setLoading(!seeded)
  }, [orgId])

  useEffect(() => {
    if (!pollEnabled) return
    void loadMessages()
  }, [loadMessages, pollEnabled])

  // Poll only while Messages pane + browser tab are visible (presence host keeps pane mounted).
  useEffect(() => {
    if (!pollEnabled) return
    const id = window.setInterval(() => {
      void loadMessages({ silent: true })
    }, 12_000)
    return () => window.clearInterval(id)
  }, [loadMessages, pollEnabled])

  const threads = useMemo(() => groupIntoThreads(messages), [messages])

  // Activity / Latest / CRM / rescue deep-link: /dashboard/messages?phone=+1…
  // Apply once, then clear the URL. Do NOT re-select on every threads poll (was yanking
  // users off a manually opened conversation when ?phone= lingered from CRM).
  useEffect(() => {
    if (!isActive) return
    const phoneQuery = searchParams.get("phone")
    if (!phoneQuery?.trim()) {
      // URL no longer carries a deep link — allow a future ?phone= to open.
      appliedDeepLinkKeyRef.current = null
      return
    }
    const decision = shouldApplyMessagesDeepLink({
      phoneQuery,
      lastAppliedKey: appliedDeepLinkKeyRef.current,
    })
    if (!decision.apply) {
      // Already opened this deep link — strip stale params so poll cannot fight selection.
      clearMessagesDeepLinkUrl()
      return
    }

    const resolved = resolveMessagesDeepLinkPhone(phoneQuery, threads)
    if (!resolved) return

    appliedDeepLinkKeyRef.current = decision.key
    setSelectedPhone(resolved)
    setSendError(null)

    // CRM follow-up: consume ?draft= together with the phone open.
    const draftParam = searchParams.get("draft")?.trim()
    if (draftParam) setDraft(draftParam)

    clearMessagesDeepLinkUrl()
  }, [searchParams, threads, isActive, clearMessagesDeepLinkUrl])

  const activeThread = useMemo((): SmsThread | null => {
    if (!selectedPhone) return null
    // Exact key first, then last-10 match (deep-link format may differ from DB).
    const key = phoneMatchKey(selectedPhone)
    const found =
      threads.find((t) => t.customerPhone === selectedPhone) ||
      (key.length >= 10
        ? threads.find((t) => phoneMatchKey(t.customerPhone) === key)
        : undefined)
    if (found) return found
    // Deep-link / new follow-up before any sms_messages row exists.
    const now = new Date().toISOString()
    return {
      customerPhone: selectedPhone,
      messages: [],
      lastMessage: {
        id: "__empty__",
        organization_id: null,
        owner_user_id: "",
        phone_number_id: null,
        direction: "outbound",
        from_number: "",
        to_number: selectedPhone,
        body: "",
        customer_phone: selectedPhone,
        telnyx_message_id: null,
        status: "queued",
        created_at: now,
      },
      needsReply: false,
    }
  }, [threads, selectedPhone])

  // Last inbound / outbound bodies for reply chips (empty thread → no suggestions).
  const lastInboundBody = useMemo(() => {
    if (!activeThread?.messages.length) return ""
    const inbound = [...activeThread.messages]
      .reverse()
      .find((m) => m.direction === "inbound")
    return (inbound?.body || "").trim()
  }, [activeThread])

  const lastOutboundBody = useMemo(() => {
    if (!activeThread?.messages.length) return ""
    const outbound = [...activeThread.messages]
      .reverse()
      .find((m) => m.direction === "outbound")
    return (outbound?.body || "").trim()
  }, [activeThread])

  // Rule-based chips — same helpers as Latest Needs-reply sheet.
  const replySuggest = useMemo(() => {
    if (!lastInboundBody) {
      return {
        intent: "generic" as SmsReplyIntent,
        chips: [] as SmsReplyChip[],
        drafts: [] as string[],
      }
    }
    return buildHeuristicSmsReplySuggestions({
      customerMessage: lastInboundBody,
      customerName,
      businessName:
        workspaceBusinessName ||
        extractBusinessNameFromSmsBody(lastOutboundBody) ||
        null,
      vehicle: extractVehicleFromSmsBody(lastOutboundBody),
      priorOutbound: lastOutboundBody || null,
    })
  }, [lastInboundBody, lastOutboundBody, customerName, workspaceBusinessName])

  // Soft-reset suggestion UI when switching conversations.
  useEffect(() => {
    setAiDrafts([])
    setSuggestLoading(false)
    setCustomerName(null)
  }, [selectedPhone])

  // Best-effort CRM name for chip greetings (non-blocking).
  useEffect(() => {
    if (!isActive || !selectedPhone) return
    let cancelled = false
    const qs = new URLSearchParams({ phone: selectedPhone })
    void fetch(`/api/customers?${qs}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { customers?: Array<{ display_name?: string | null }> } | null) => {
        if (cancelled) return
        const name = String(json?.customers?.[0]?.display_name ?? "").trim()
        setCustomerName(name || null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isActive, selectedPhone])

  /** Suggest reply — fills drafts; never auto-sends. */
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
          customer_name: customerName || undefined,
          business_name: workspaceBusinessName || undefined,
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
      const next =
        drafts.filter((d) => d.trim()).length > 0
          ? drafts.filter((d) => d.trim())
          : replySuggest.drafts
      setAiDrafts(next)
      if (next[0]) setDraft(next[0])
    } catch {
      // Offline / no key: still fill from local heuristic drafts.
      if (replySuggest.drafts[0]) {
        setAiDrafts(replySuggest.drafts)
        setDraft(replySuggest.drafts[0])
      }
    } finally {
      setSuggestLoading(false)
    }
  }

  // tel:+1… for the open thread header (one-tap call on phones).
  const threadTelHref = activeThread ? buildTelHref(activeThread.customerPhone) : null
  // Pretty display next to the dial link (keeps parentheses/dashes).
  const threadPhoneLabel = activeThread
    ? formatPhoneDisplay(activeThread.customerPhone)
    : ""

  // Book-form alert context: offer a way back to submitted fields (SMS alone won’t show them).
  const showBookingDetailsBanner = Boolean(
    isActive &&
      selectedPhone &&
      bookFormHandoffMatchesPhone(selectedPhone)
  )
  const bookingHandoffPreview = showBookingDetailsBanner
    ? peekBookFormDetailsHandoff()
    : null

  /** Leave Messages and reopen the Lines booking-details sheet. */
  const openBookingDetailsFromBanner = useCallback(() => {
    requestReopenBookFormDetail()
    router.push("/dashboard")
  }, [router])

  // Opening a thread clears the Latest unread dot for that phone.
  useEffect(() => {
    if (!isActive || !selectedPhone) return
    markLatestReplySeen(selectedPhone)
  }, [isActive, selectedPhone])

  // Keep the latest bubble in view inside the list — do not scroll the page shell.
  useEffect(() => {
    if (!isActive || !selectedPhone) return
    const scroller = messagesScrollRef.current
    if (!scroller) return
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" })
  }, [isActive, selectedPhone, activeThread?.messages.length])

  async function sendReply() {
    const to = selectedPhone
    const text = draft.trim()
    if (!to || !text || sending) return
    setSending(true)
    setSendError(null)
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
      const json = (await res.json()) as {
        error?: string
        data?: { message?: SmsMessage | null; delivery_warning?: string | null }
      }
      if (!res.ok) throw new Error(json.error || "Could not send message")
      // Sending a reply clears this thread from Latest (same as opening it).
      markLatestReplySeen(to)
      if (json.data?.message) {
        setLiveMessages((prev) => [json.data!.message!, ...(prev ?? cachedMessages)])
      } else {
        await loadMessages({ silent: true })
      }
      if (json.data?.delivery_warning) {
        setSendError(json.data.delivery_warning)
      }
      setDraft("")
      setAiDrafts([])
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not send message")
    } finally {
      setSending(false)
    }
  }

  return (
    <WorkspacePage
      className={cn(
        // Tighter page chrome on phones; clear the dock + home indicator on list + thread.
        threadOpen
          ? "gap-2 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:gap-6 md:pb-8"
          : "gap-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:gap-6 md:pb-8"
      )}
    >
      {/* Title row — compact + single-line on mobile when a conversation is open */}
      <div
        className={cn(
          "flex min-w-0 items-center justify-between gap-2",
          !threadOpen && "items-start gap-3 sm:flex-row sm:flex-wrap sm:justify-between"
        )}
      >
        <div className="min-w-0">
          {!threadOpen ? (
            <p className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-primary md:block">
              SMS
            </p>
          ) : null}
          <h1
            className={cn(
              "font-semibold tracking-tight text-foreground",
              threadOpen
                ? "text-lg md:text-2xl"
                : "text-xl sm:text-2xl md:mt-1 md:text-3xl"
            )}
          >
            Messages
          </h1>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("shrink-0", threadOpen && "h-8 px-2.5 text-xs")}
          disabled={loading}
          onClick={() => void loadMessages()}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {/* Non-actionable blurb: desktop inbox only — never when a thread is open */}
      {!threadOpen ? (
        <p className="hidden max-w-2xl text-sm text-muted-foreground md:block">
          Texts to and from your business line — including Missed Call Rescue textbacks and customer
          replies. Select a conversation to reply.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <WorkspacePanel
        className={cn(
          "overflow-hidden bg-background shadow-none ring-0 md:grid md:grid-cols-[minmax(240px,320px)_1fr] md:grid-rows-1",
          // Thread open: fill remaining shell (header + dock + compact title) so only bubbles scroll.
          threadOpen
            ? "flex h-[calc(100dvh-var(--shell-header-h)-var(--shell-dock-h)-3.75rem)] flex-col md:h-[calc(100dvh-var(--shell-header-h)-10rem)]"
            : cn("grid", MOBILE_PANEL_VIEWPORT_MIN_H)
        )}
      >
        {/* Thread list — hidden on mobile when a conversation is open */}
        <div
          className={cn(
            "flex min-h-0 flex-col border-border/60 md:border-r",
            selectedPhone ? "hidden md:flex" : "flex min-h-[50vh] md:min-h-0"
          )}
        >
          <div className="border-b border-border/60 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Conversations
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && threads.length === 0 ? (
              <MessagesThreadListSkeleton count={6} />
            ) : threads.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/50" aria-hidden />
                <p className="text-sm font-medium text-foreground">No texts yet</p>
                <p className="text-xs text-muted-foreground">
                  When Missed Call Rescue texts a booking link, or a customer texts your line, the
                  thread shows up here.
                </p>
              </div>
            ) : (
              threads.map((thread) => {
                const active = thread.customerPhone === selectedPhone
                return (
                  <button
                    key={thread.customerPhone}
                    type="button"
                    onClick={() => {
                      // Manual pick wins — clear any lingering ?phone= so poll cannot override.
                      appliedDeepLinkKeyRef.current = null
                      clearMessagesDeepLinkUrl()
                      setSelectedPhone(thread.customerPhone)
                      setSendError(null)
                    }}
                    className={cn(
                      "flex w-full flex-col gap-0.5 border-b border-border/40 px-4 py-3 text-left transition-colors",
                      active
                        ? "bg-emerald-500/10"
                        : "hover:bg-muted/40",
                      thread.needsReply && !active && "bg-amber-500/5"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {formatPhoneDisplay(thread.customerPhone)}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {formatMessageTime(thread.lastMessage.created_at)}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "truncate text-xs",
                        thread.needsReply
                          ? "font-medium text-amber-100/90"
                          : "text-muted-foreground"
                      )}
                    >
                      {thread.lastMessage.direction === "outbound" ? "You: " : ""}
                      {thread.lastMessage.body}
                    </p>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Conversation pane — message list scrolls; composer stays pinned */}
        <div
          className={cn(
            "flex min-h-0 flex-col",
            selectedPhone ? "flex flex-1" : "hidden min-h-[50vh] md:flex md:min-h-0"
          )}
        >
          {!activeThread ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8 opacity-40" aria-hidden />
              <p className="text-sm">Select a conversation to read and reply</p>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2 md:px-4 md:py-3">
                <button
                  type="button"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground md:hidden"
                  aria-label="Back to conversations"
                  onClick={() => {
                    appliedDeepLinkKeyRef.current = null
                    clearMessagesDeepLinkUrl()
                    setSelectedPhone(null)
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  {threadTelHref ? (
                    // One-tap call: tap the number → phone dialer opens.
                    <a
                      href={threadTelHref}
                      className="inline-flex min-h-11 max-w-full items-center truncate text-sm font-semibold text-foreground underline-offset-2 hover:underline"
                      aria-label={`Call ${threadPhoneLabel}`}
                    >
                      {threadPhoneLabel}
                    </a>
                  ) : (
                    <p className="truncate text-sm font-semibold text-foreground">
                      {threadPhoneLabel}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {activeThread.messages.length} message
                    {activeThread.messages.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              {showBookingDetailsBanner ? (
                // Escape hatch: SMS only has the pick-a-time link — form data lives on Lines.
                <div className="shrink-0 border-b border-orange-500/30 bg-orange-500/10 px-3 py-2.5 md:px-4">
                  <p className="text-[11px] font-medium text-orange-100/90">
                    {bookingHandoffPreview?.customerName
                      ? `${bookingHandoffPreview.customerName} submitted a booking`
                      : "Customer submitted a booking"}
                    {bookingHandoffPreview?.preview
                      ? ` · ${bookingHandoffPreview.preview}`
                      : ""}
                  </p>
                  <button
                    type="button"
                    onClick={openBookingDetailsFromBanner}
                    className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-50 underline-offset-2 hover:underline"
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    View booking details
                  </button>
                </div>
              ) : null}

              <div
                ref={messagesScrollRef}
                className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3 md:px-4 md:py-4"
              >
                {activeThread.messages.map((msg) => {
                  const outbound = msg.direction === "outbound"
                  const deliveryLabel = outbound ? formatOutboundDeliveryLabel(msg) : null
                  return (
                    <div
                      key={msg.id}
                      className={cn("flex", outbound ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-snug",
                          outbound
                            ? msg.status === "failed"
                              ? "rounded-br-md bg-rose-700 text-white"
                              : "rounded-br-md bg-emerald-600 text-white"
                            : "rounded-bl-md border border-border/60 bg-muted/50 text-foreground"
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
                <div ref={bottomRef} />
              </div>

              <div className="shrink-0 border-t border-border/60 px-3 py-2.5 md:px-4 md:py-3">
                {sendError ? (
                  <p className="mb-2 text-xs text-red-300">{sendError}</p>
                ) : null}

                {/* Quick reply chips — only when the thread has an inbound message to answer. */}
                {replySuggest.chips.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {replySuggest.chips.map((chip) => (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => setDraft(chip.body)}
                        className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/20"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* Suggest reply → AI or rule-based drafts (still requires Send). */}
                {lastInboundBody ? (
                  <button
                    type="button"
                    onClick={() => void suggestReply()}
                    disabled={suggestLoading}
                    className="mb-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-500/20 disabled:opacity-50"
                  >
                    {suggestLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Suggest reply
                  </button>
                ) : null}

                {aiDrafts.length > 1 ? (
                  <div className="mb-2 space-y-1.5">
                    {aiDrafts.map((option, idx) => (
                      <button
                        key={`ai-draft-${idx}`}
                        type="button"
                        onClick={() => setDraft(option)}
                        className="w-full rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2 text-left text-[11px] leading-snug text-foreground/90 hover:bg-muted/40"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="flex items-end gap-2">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type a reply…"
                    rows={2}
                    disabled={sending}
                    className="min-h-[40px] flex-1 resize-none bg-background md:min-h-[44px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        void sendReply()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    disabled={sending || !draft.trim()}
                    onClick={() => void sendReply()}
                    className="shrink-0 bg-emerald-600 hover:bg-emerald-500"
                    aria-label="Send reply"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
})

/** Outer wrapper: URL bridge is isolated — Inner stays mounted across tab clicks. */
export const MessagesWorkspaceView = memo(function MessagesWorkspaceView({
  isActive = true,
}: {
  isActive?: boolean
}) {
  // Seed from window so ?phone= deep links paint before the bridge hydrates.
  const [urlQuery, setUrlQuery] = useState(readWindowSearchQuery)
  const onQuery = useCallback((q: string) => setUrlQuery(q), [])
  return (
    <>
      <ClientSearchParamsBridge onQuery={onQuery} />
      <MessagesWorkspaceViewInner isActive={isActive} urlQuery={urlQuery} />
    </>
  )
})
