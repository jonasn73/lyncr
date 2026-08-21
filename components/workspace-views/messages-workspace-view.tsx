"use client"

// Owner Messages inbox — thread list + conversation + reply (polls GET /api/messaging).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ClipboardList, CreditCard, Loader2, MessageSquare, Send, Sparkles, UserRound } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import {
  flickerSafeSearchParamNames,
  logFlicker,
  logFlickerNav,
  useFlickerDebugLifecycle,
} from "@/lib/debug/flicker-debug"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import {
  WorkspacePage,
  WorkspacePanel,
} from "@/components/dashboard-workspace-ui"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  findLatestBookFormForPhone,
  requestReopenBookFormDetail,
} from "@/lib/book-form-details-handoff"
import { buildTelHref } from "@/lib/phone-e164"
import { useOwnerLatest } from "@/lib/hooks/use-owner-latest"
import { usePollBudget } from "@/lib/hooks/use-poll-budget"
import { useCollectJobsQuery } from "@/lib/hooks/use-collect-jobs-query"
import { pickOpenCollectJobForPhone } from "@/lib/collect-job-match"
import { openCollectPaymentModal } from "@/lib/settings-modals-events"
import { markLatestReplySeen } from "@/lib/latest-seen"
import { formatSmsDeliveryLabel } from "@/lib/sms-delivery-labels"
import { useSessionSeed } from "@/lib/hooks/use-client-seed"
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
  buildConversationFollowUpChips,
  buildHeuristicSmsReplySuggestions,
  extractBusinessNameFromSmsBody,
  extractVehicleFromSmsBody,
  type SmsReplyChip,
  type SmsReplyIntent,
} from "@/lib/sms-reply-suggestions"
import { formatVehicleForSms, formatCustomerNeedPhrase } from "@/lib/amber-coworker-commands"
import { DEFAULT_SMS_PHASE_TEMPLATES } from "@/lib/sms-template-defaults"
import { DEFAULT_SMS_STATUS_TEMPLATES, renderStatusSms } from "@/lib/sms-status-templates"
import type { OwnerSmsSnippet, OwnerSmsStatusTemplates } from "@/lib/types"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"
import type { SmsMessage } from "@/lib/types"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"
import {
  resolveOwnerTimezone,
} from "@/lib/browser-timezone-cookie"
import { formatOwnerListTime } from "@/lib/settled-paint"
import {
  messagesFingerprint,
  messagesPaintToSms,
  messagesThreadListFingerprint,
  messagesThreadListIsQuietExpansion,
  writeMessagesPaintSeed,
  type MessagesPaintSeed,
} from "@/lib/messages-paint-cache"

const EMPTY_MESSAGES: SmsMessage[] = []

function messagesCacheKey(orgId: string | null): string {
  return persistedCacheKey("messages-inbox", orgId ?? "default")
}

function readMessagesCache(
  orgId: string | null,
  paint?: MessagesPaintSeed | null
): SmsMessage[] {
  const cached = readPersistedCache<{ messages: SmsMessage[] }>(messagesCacheKey(orgId))
  if (cached && Array.isArray(cached.messages) && cached.messages.length > 0) {
    return cached.messages
  }
  if (paint?.messages.length) return messagesPaintToSms(paint)
  if (!cached || !Array.isArray(cached.messages)) return EMPTY_MESSAGES
  return cached.messages.length > 0 ? cached.messages : EMPTY_MESSAGES
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
  const paintSeeds = useDashboardPaintSeeds()
  // Layout cookie only — never re-parse document.cookie every render (unstable object → org-clear loop).
  const messagesPaint = paintSeeds.messages
  // Prefer SSR seed zone so first HTML matches hydrate (Node Intl is often UTC).
  const messageTimeZone = paintSeeds.timeZone || resolveOwnerTimezone()
  // Stick to cookie paint until first fetch — session unlock was flashing rows 11+ mid-hydrate.
  const [holdPaintList, setHoldPaintList] = useState(
    () => Boolean(messagesPaint?.messages?.length)
  )
  const paintListMessages = useMemo(
    () => (messagesPaint?.messages.length ? messagesPaintToSms(messagesPaint) : EMPTY_MESSAGES),
    [messagesPaint]
  )
  // Shared Latest cache — leftover book forms for the orange thread banner.
  const { items: latestItems } = useOwnerLatest(activeOrganizationId)
  // Workspace / org name for chip sign-offs (falls back to outbound “Name — …” prefix).
  const workspaceBusinessName =
    organizations.find((o) => o.id === activeOrganizationId)?.name?.trim() ||
    organizations[0]?.name?.trim() ||
    ""

  // Bumps after a successful full fetch so useSessionSeed re-reads session (not stale paint stubs).
  const [inboxSeedRevision, setInboxSeedRevision] = useState(0)
  const cachedMessages = useSessionSeed(
    () => readMessagesCache(orgId, messagesPaint),
    EMPTY_MESSAGES,
    `${orgId ?? "default"}:${messagesPaint?.messages.length ?? 0}:r${inboxSeedRevision}`
  )
  const [liveMessages, setLiveMessages] = useState<SmsMessage[] | null>(null)
  const messages =
    liveMessages ?? (holdPaintList && paintListMessages.length > 0 ? paintListMessages : cachedMessages)
  const messagesForCompareRef = useRef(messages)
  messagesForCompareRef.current = messages
  // Stable thread timestamps — freeze per phone+msg id so row 3 date doesn’t flip on hydrate.
  const threadTimeLabelRef = useRef(new Map<string, { id: string; label: string }>())
  const threadTimeLabel = (phone: string, msgId: string, iso: string) => {
    const key = phoneMatchKey(phone) || phone
    const prev = threadTimeLabelRef.current.get(key)
    if (prev && prev.id === msgId) return prev.label
    const label = formatOwnerListTime(iso, messageTimeZone)
    threadTimeLabelRef.current.set(key, { id: msgId, label })
    return label
  }
  // Spinner only on cold cache — cookie/session paint skips the empty well flash.
  const [loading, setLoading] = useState(() => cachedMessages.length === 0)
  // True after first successful fetch (or non-empty seed) — gates “No texts yet”.
  const [inboxSettled, setInboxSettled] = useState(() => cachedMessages.length > 0)
  const [error, setError] = useState<string | null>(null)
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const prevOrgForInboxRef = useRef<string | null | undefined>(undefined)
  const threadScrollHydratedRef = useRef<string | null>(null)

  useFlickerDebugLifecycle("MessagesWorkspaceView", {
    isActive,
    loading,
    messageCount: messages.length,
    liveMessagesNull: liveMessages == null,
    cachedMessageCount: cachedMessages.length,
    showingEmpty: !loading && messages.length === 0,
    threadOpen: Boolean(selectedPhone),
    searchParamNames: flickerSafeSearchParamNames(urlQuery).join(","),
  })

  // Leftover book form for this thread (banner + chips — no Lines tap required).
  const threadBookForm = useMemo(
    () => (selectedPhone ? findLatestBookFormForPhone(latestItems, selectedPhone) : null),
    [latestItems, selectedPhone]
  )
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // True while POST /api/messaging/suggest-reply is in flight.
  const [suggestLoading, setSuggestLoading] = useState(false)
  // Extra draft options from Suggest reply (tap fills composer — never auto-sends).
  const [aiDrafts, setAiDrafts] = useState<string[]>([])
  // Optional CRM display name for friendlier chip copy (loaded when a thread opens).
  const [customerName, setCustomerName] = useState<string | null>(null)
  // True when CRM already has a row for this phone (even with no display name).
  const [customerSaved, setCustomerSaved] = useState(false)
  // True after /api/customers returns so we don’t flash “no form” on a saved person.
  const [customerLookupDone, setCustomerLookupDone] = useState(false)
  // Saved shortcuts + status copy from Settings → SMS templates (fill composer, never auto-send).
  const [customSnippets, setCustomSnippets] = useState<OwnerSmsSnippet[]>([])
  const [statusTemplates, setStatusTemplates] = useState<OwnerSmsStatusTemplates>({
    ...DEFAULT_SMS_STATUS_TEMPLATES,
  })
  const [routeTemplate, setRouteTemplate] = useState(DEFAULT_SMS_PHASE_TEMPLATES.route)
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
    logFlickerNav("replace", "/dashboard/messages", "MessagesWorkspaceView")
    router.replace("/dashboard/messages", { scroll: false })
  }, [router, searchParams])

  const hasPaintedMessagesRef = useRef(false)
  if (messages.length > 0) hasPaintedMessagesRef.current = true

  useEffect(() => {
    if (cachedMessages.length > 0) {
      hasPaintedMessagesRef.current = true
      setLoading(false)
      setInboxSettled(true)
    }
  }, [cachedMessages.length])

  const loadMessages = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? hasPaintedMessagesRef.current
      // Never flip the full pane to loading when rows are already on screen.
      if (!silent && !hasPaintedMessagesRef.current) {
        logFlicker({
          event: "loading-true",
          component: "MessagesWorkspaceView",
          reason: "load-messages-not-silent",
          fullPaneLoading: true,
        })
        setLoading(true)
      }
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
        setLiveMessages((prev) => {
          const baseline = prev ?? messagesForCompareRef.current
          if (
            baseline.length > 0 &&
            (messagesFingerprint(baseline) === messagesFingerprint(next) ||
              (messagesThreadListFingerprint(baseline) === messagesThreadListFingerprint(next) &&
                baseline.length >= next.length))
          ) {
            return prev ?? baseline
          }
          // Same conversation heads — fuller bodies, or more threads below the paint cutoff.
          if (
            baseline.length > 0 &&
            (messagesThreadListFingerprint(baseline) === messagesThreadListFingerprint(next) ||
              messagesThreadListIsQuietExpansion(baseline, next))
          ) {
            return next
          }
          logFlicker({
            event: "list-replace",
            component: "MessagesWorkspaceView",
            messageCount: next.length,
            liveMessagesNull: false,
          })
          return next
        })
        writePersistedCache(messagesCacheKey(orgId), { messages: next })
        writeMessagesPaintSeed(next, orgId)
        setHoldPaintList(false)
        setInboxSeedRevision((n) => n + 1)
        hasPaintedMessagesRef.current = true
        setInboxSettled(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load messages")
      } finally {
        setLoading(false)
      }
    },
    [orgId]
  )

  // Org switch only — never clear live when paint cookie object identity churns.
  useEffect(() => {
    const prev = prevOrgForInboxRef.current
    prevOrgForInboxRef.current = orgId
    // First mount — keep painted seed / live; do not wipe.
    if (prev === undefined) return
    if (prev === orgId) return

    logFlicker({
      event: "list-clear",
      component: "MessagesWorkspaceView",
      reason: "org-switch",
      liveMessagesNull: true,
    })
    setLiveMessages(null)
    threadScrollHydratedRef.current = null
    threadTimeLabelRef.current.clear()
    const seeded = readMessagesCache(orgId, messagesPaint).length > 0
    hasPaintedMessagesRef.current = seeded
    setHoldPaintList(Boolean(messagesPaint?.messages?.length))
    setInboxSettled(seeded)
    if (!seeded) {
      logFlicker({
        event: "loading-true",
        component: "MessagesWorkspaceView",
        reason: "org-switch-no-seed",
        fullPaneLoading: true,
      })
    }
    setLoading(!seeded)
  }, [orgId, messagesPaint])

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

  // Warm Collect jobs while a thread is open — used to show Collect when this phone still owes.
  const { jobs: collectJobs } = useCollectJobsQuery(isActive && Boolean(selectedPhone))
  const threadHasUnpaidJob = useMemo(() => {
    if (!selectedPhone) return false
    const want = phoneMatchKey(selectedPhone)
    if (!want) return false
    return collectJobs.some((job) => {
      const status = (job.job_status ?? "").toLowerCase()
      // Ignore completed/cancelled — collect-jobs can fall back to recent finished jobs.
      if (status === "completed" || status === "cancelled" || status === "canceled") {
        return false
      }
      const jobPhone = phoneMatchKey(job.customer_phone || "")
      return Boolean(jobPhone && jobPhone === want)
    })
  }, [collectJobs, selectedPhone])

  const crmHrefForThread = selectedPhone
    ? `/dashboard/customers?phone=${encodeURIComponent(selectedPhone)}`
    : "/dashboard/customers"

  const openCollectForThread = useCallback(() => {
    if (!selectedPhone) return
    const match = pickOpenCollectJobForPhone(collectJobs, selectedPhone)
    if (match) {
      openCollectPaymentModal({
        customerName: customerName || undefined,
        customerPhone: selectedPhone,
        jobId: match.id,
      })
      return
    }
    openCollectPaymentModal({
      customerName: customerName || undefined,
      customerPhone: selectedPhone,
      startAdhoc: true,
    })
  }, [customerName, selectedPhone, collectJobs])

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

  // Rule-based chips — inbound replies plus booking follow-ups even if they have not written back.
  const replySuggest = useMemo(() => {
    const handoff = threadBookForm
    const chipName = customerName || handoff?.customerName || null
    const business =
      workspaceBusinessName ||
      extractBusinessNameFromSmsBody(lastOutboundBody) ||
      null
    const vehicle =
      formatVehicleForSms({
        year: handoff?.bookFormVehicleYear,
        make: handoff?.bookFormVehicleMake,
        model: handoff?.bookFormVehicleModel,
      }) ||
      extractVehicleFromSmsBody(handoff?.preview) ||
      extractVehicleFromSmsBody(lastOutboundBody) ||
      ""
    const jobLabel = String(handoff?.bookFormJobType || "").trim()
    const need = formatCustomerNeedPhrase({ vehicle, jobLabel })
    const inbound = lastInboundBody
      ? buildHeuristicSmsReplySuggestions({
          customerMessage: lastInboundBody,
          customerName: chipName,
          businessName: business,
          vehicle,
          priorOutbound: lastOutboundBody || null,
        })
      : {
          intent: "generic" as SmsReplyIntent,
          chips: [] as SmsReplyChip[],
          drafts: [] as string[],
        }
    const follow = buildConversationFollowUpChips({
      customerName: chipName,
      businessName: business,
      vehicle,
      jobLabel,
    })
    const first = String(chipName || "")
      .trim()
      .split(/\s+/)[0] || "there"
    const biz = String(business || "").trim() || "us"
    const vehicleBit = need ? `the ${need}` : "that"
    const fillTags = (body: string) =>
      body
        .replace(/\{\{\s*customer_name\s*\}\}/gi, first)
        .replace(/\{\{\s*business_name\s*\}\}/gi, biz)
        .replace(/\{\{\s*vehicle\s*\}\}/gi, vehicleBit)
        .replace(/[ \t]{2,}/g, " ")
        .trim()
    const fromTemplates: SmsReplyChip[] = [
      {
        id: "follow-status",
        label: "Status",
        body: renderStatusSms(
          statusTemplates.check_in || DEFAULT_SMS_STATUS_TEMPLATES.check_in,
          {
            customer_name: first,
            business_name: biz,
            vehicle: vehicleBit,
          }
        ),
      },
      {
        id: "follow-onway",
        label: "On my way",
        body: fillTags(routeTemplate || DEFAULT_SMS_PHASE_TEMPLATES.route),
      },
    ]
    const details = follow.filter((c) => c.id === "follow-details")
    const statusChips: SmsReplyChip[] = [
      {
        id: "status-late",
        label: "Running late",
        body: renderStatusSms(statusTemplates.late || DEFAULT_SMS_STATUS_TEMPLATES.late, {
          customer_name: first,
          business_name: biz,
          eta_minutes: 15,
        }),
      },
      {
        id: "status-here",
        label: "I'm here",
        body: renderStatusSms(statusTemplates.arrived || DEFAULT_SMS_STATUS_TEMPLATES.arrived, {
          customer_name: first,
          business_name: biz,
        }),
      },
    ]
    const saved = customSnippets
      .filter((snip) => snip?.body?.trim())
      .slice(0, 4)
      .map((snip) => ({
        id: `snip-${snip.id}`,
        label: snip.label?.trim() || "Saved text",
        body: fillTags(snip.body),
      }))
    const seen = new Set<string>()
    const chips: SmsReplyChip[] = []
    for (const chip of [...inbound.chips.slice(0, 2), ...fromTemplates, ...details, ...statusChips, ...saved]) {
      if (!chip.body.trim() || seen.has(chip.id)) continue
      seen.add(chip.id)
      chips.push(chip)
    }
    return {
      intent: inbound.intent,
      chips: chips.slice(0, 8),
      drafts: inbound.drafts,
    }
  }, [
    lastInboundBody,
    lastOutboundBody,
    customerName,
    workspaceBusinessName,
    selectedPhone,
    threadBookForm,
    customSnippets,
    statusTemplates,
    routeTemplate,
  ])

  // Soft-reset suggestion UI when switching conversations.
  useEffect(() => {
    setAiDrafts([])
    setSuggestLoading(false)
    setCustomerName(null)
    setCustomerSaved(false)
    setCustomerLookupDone(false)
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
        const rows = Array.isArray(json?.customers) ? json!.customers! : []
        setCustomerSaved(rows.length > 0)
        const name = String(rows[0]?.display_name ?? "").trim()
        setCustomerName(name || null)
        setCustomerLookupDone(true)
      })
      .catch(() => {
        if (!cancelled) setCustomerLookupDone(true)
      })
    return () => {
      cancelled = true
    }
  }, [isActive, selectedPhone])

  // Load saved SMS shortcuts once while Messages is open.
  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    void fetch("/api/owner/sms-settings", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (json: {
          data?: {
            sms_custom_snippets?: OwnerSmsSnippet[]
            sms_status_templates?: OwnerSmsStatusTemplates
            sms_route_template?: string | null
          }
        } | null) => {
          if (cancelled || !json?.data) return
          const list = Array.isArray(json.data.sms_custom_snippets)
            ? json.data.sms_custom_snippets
            : []
          setCustomSnippets(list.filter((s) => s?.body?.trim()))
          if (json.data.sms_status_templates && typeof json.data.sms_status_templates === "object") {
            setStatusTemplates({
              ...DEFAULT_SMS_STATUS_TEMPLATES,
              ...json.data.sms_status_templates,
            })
          }
          const route = String(json.data.sms_route_template || "").trim()
          if (route) setRouteTemplate(route)
        }
      )
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isActive])

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

  const showBookingDetailsBanner = Boolean(isActive && selectedPhone && threadBookForm)
  // Texts-only thread — don’t send the owner to empty CRM.
  const showNoFormYetCue = Boolean(
    isActive &&
      selectedPhone &&
      !threadBookForm &&
      customerLookupDone &&
      !customerSaved &&
      !customerName
  )
  const showCrmChip = Boolean(threadBookForm || customerSaved || customerName)

  /** Slide the existing Booking request sheet over this thread. */
  const openBookingDetailsFromBanner = useCallback(() => {
    if (!threadBookForm) return
    requestReopenBookFormDetail(threadBookForm)
  }, [threadBookForm])

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
    const firstFill = threadScrollHydratedRef.current !== selectedPhone
    threadScrollHydratedRef.current = selectedPhone
    // First hydrate: jump instantly (stub → full must not animate). Later appends can ease.
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: firstFill ? "auto" : "smooth",
    })
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

  // Stable page chrome — never change gap/padding when a thread opens (that was the CLS).
  return (
    <WorkspacePage className="gap-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] sm:gap-6 md:pb-8">
      {/* Title row — fixed geometry whether a conversation is open or not */}
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={cn(
              "hidden min-h-[1rem] text-[10px] font-semibold uppercase tracking-[0.14em] text-primary md:block",
              threadOpen && "invisible"
            )}
          >
            SMS
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl md:mt-1 md:text-3xl">
            Messages
          </h1>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-[5.5rem] shrink-0 px-2.5 text-xs"
          disabled={loading}
          onClick={() => void loadMessages()}
        >
          {loading ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {/* Reserve blurb height on desktop so opening a thread does not pull the panel up */}
      <p
        className={cn(
          "hidden min-h-[2.5rem] max-w-2xl text-sm text-muted-foreground md:block",
          threadOpen && "invisible"
        )}
      >
        Texts to and from your business line — including Missed Call Rescue textbacks and customer
        replies. Select a conversation to reply.
      </p>

      {error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <WorkspacePanel
        className={cn(
          "flex h-[calc(100dvh-var(--shell-header-h)-var(--shell-dock-h)-8.5rem)] flex-col overflow-hidden bg-background shadow-none ring-0",
          "md:grid md:h-[calc(100dvh-var(--shell-header-h)-12rem)] md:grid-cols-[minmax(240px,320px)_1fr] md:grid-rows-1"
        )}
      >
        {/* Thread list — stay in layout on desktop; hide on mobile when a conversation is open */}
        <div
          className={cn(
            "flex min-h-0 flex-col border-border/60 md:border-r",
            selectedPhone ? "hidden md:flex" : "flex"
          )}
        >
          <div className="border-b border-border/60 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Conversations
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!inboxSettled || (loading && threads.length === 0) ? (
              // Quiet well — never show MessageSquare / “No texts yet” mid-load.
              <div className="h-full min-h-[12rem]" aria-busy="true" aria-label="Loading messages" />
            ) : threads.length === 0 ? (
              <div className="flex h-full min-h-[12rem] flex-col items-center gap-3 px-6 py-16 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/50" aria-hidden />
                <p className="text-sm font-medium text-foreground">No texts yet</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  When a customer texts your line — or you text from Activity / CRM — the thread
                  shows up here.
                </p>
                <Link
                  href="/dashboard/activity"
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 text-xs font-semibold text-sky-100 hover:bg-sky-500/20"
                >
                  Open Activity
                </Link>
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
                      "flex w-full flex-col gap-0.5 border-b border-border/40 px-4 py-3 text-left",
                      "transition-[background-color,transform] duration-150 ease-out motion-safe:active:scale-[0.99]",
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
                        {threadTimeLabel(
                          thread.customerPhone,
                          thread.lastMessage.id,
                          thread.lastMessage.created_at
                        )}
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
            selectedPhone ? "flex flex-1" : "hidden md:flex"
          )}
        >
          {!activeThread ? (
            !inboxSettled || loading || threads.length === 0 ? (
              // Quiet reserve while inbox loads — MessageSquare mid-page was the flash.
              <div
                className="min-h-0 flex-1"
                aria-busy={!inboxSettled || loading}
                aria-label={!inboxSettled || loading ? "Loading conversations" : undefined}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
                <MessageSquare className="h-8 w-8 opacity-40" aria-hidden />
                <p className="text-sm">Select a conversation to read and reply</p>
              </div>
            )
          ) : (
            <>
              <div className="flex min-h-[4.25rem] shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2 md:px-4 md:py-3">
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
                {/* Always two lines — CRM name must not grow the header after lookup. */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {customerName?.trim() || threadPhoneLabel || "\u00a0"}
                  </p>
                  <p className="min-h-5 truncate text-[11px] text-muted-foreground">
                    {customerName?.trim() && threadTelHref ? (
                      <a
                        href={threadTelHref}
                        className="underline-offset-2 hover:underline"
                        aria-label={`Call ${threadPhoneLabel}`}
                      >
                        {threadPhoneLabel}
                      </a>
                    ) : customerName?.trim() ? (
                      threadPhoneLabel
                    ) : null}
                    {customerName?.trim() ? " · " : null}
                    {activeThread.messages.length} message
                    {activeThread.messages.length === 1 ? "" : "s"}
                  </p>
                </div>
                {/* Fixed chip strip — CRM / Collect appear without growing the row. */}
                <div className="flex h-9 min-w-[5.5rem] shrink-0 items-center justify-end gap-1.5">
                  {showCrmChip ? (
                    <Link
                      href={crmHrefForThread}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-border/70 bg-muted/40 px-2.5 text-[11px] font-semibold text-foreground hover:bg-muted/70"
                      aria-label="Open customer in CRM"
                    >
                      <UserRound className="h-3.5 w-3.5" aria-hidden />
                      CRM
                    </Link>
                  ) : null}
                  {threadHasUnpaidJob ? (
                    <button
                      type="button"
                      onClick={openCollectForThread}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/25"
                      aria-label="Collect payment"
                    >
                      <CreditCard className="h-3.5 w-3.5" aria-hidden />
                      Collect
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Banner strip always reserved — booking / no-form copy swaps inside. */}
              <div className="min-h-[4.5rem] shrink-0 border-b border-border/60">
                {showBookingDetailsBanner ? (
                  <div className="border-b border-orange-500/30 bg-orange-500/10 px-3 py-2.5 md:px-4">
                    <p className="truncate text-[11px] font-medium text-orange-100/90">
                      {threadBookForm?.customerName
                        ? `${threadBookForm.customerName} submitted a booking`
                        : "Customer submitted a booking"}
                      {threadBookForm?.preview
                        ? ` · ${threadBookForm.preview}`
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
                ) : showNoFormYetCue ? (
                  <div className="bg-muted/20 px-3 py-2.5 md:px-4">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      No booking form yet. Reply here — or they can use the book link you sent.
                    </p>
                  </div>
                ) : null}
              </div>

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
                          {formatOwnerListTime(msg.created_at, messageTimeZone)}
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

                {/* Quick reply chips — tap fills the box. You still tap Send. */}
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
