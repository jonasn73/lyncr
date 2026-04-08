"use client"

import { useState, useEffect, useMemo } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import {
  Phone,
  PhoneForwarded,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Clock,
  TrendingUp,
  Voicemail,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  X,
  User,
  Bot,
  ChevronRight,
  Check,
  Plus,
  Loader2,
  Trash2,
  Sparkles,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { EmptyState } from "@/components/ui/empty-state"
import { IconSurface } from "@/components/ui/icon-surface"
import { Switch } from "@/components/ui/switch"
import { AiIntakeFlowPanel } from "@/components/ai-intake-flow-panel"
import { useOperationsData } from "@/lib/hooks/use-operations-data"
import type { PhoneNumberRoutingSummary } from "@/lib/types"

// Format E.164 to display, e.g. +15025551234 -> (502) 555-1234
function formatPhoneDisplay(phone: string | undefined | null): string {
  if (phone == null || typeof phone !== "string") return "Your cell"
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

/** Turns stored duration (seconds) into "m:ss" for the recent-calls list; returns null if no duration. */
function formatDurationMmSs(seconds: number): string | null {
  if (seconds == null || !(seconds > 0)) return null
  const whole = Math.max(0, Math.floor(seconds))
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/** Hides raw UUIDs in "routed to" when the API only has a receptionist id, not a display name. */
function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s).trim())
}

/** Returns a human label for routing, or null when we should not show "Routed to …". */
function displayRoutedTo(routedTo: string): string | null {
  if (!routedTo || routedTo === "Owner") return null
  if (looksLikeUuid(routedTo)) return null
  return routedTo
}

interface Contact {
  id: string
  name: string
  phone: string
  initials: string
  color: string
}

/** One business line on the dashboard — includes API `routing_summary` for AI confirmation. */
interface DashboardBusinessNumber {
  number: string
  status: string
  routing_summary?: PhoneNumberRoutingSummary
}

interface CallStat {
  label: string
  value: number
  icon: React.ElementType
  color: string
  bgColor: string
  suffix?: string
}

const callTypeConfig = {
  incoming: { icon: ArrowDownLeft, color: "text-success", label: "Incoming" },
  outgoing: { icon: ArrowUpRight, color: "text-chart-2", label: "Outgoing" },
  missed: { icon: PhoneMissed, color: "text-destructive", label: "Missed" },
  voicemail: { icon: Voicemail, color: "text-warning", label: "Voicemail" },
}

type FallbackOption = "owner" | "ai" | "voicemail"

const fallbackOptions: { id: FallbackOption; label: string; description: string; icon: React.ElementType; color: string; bgColor: string }[] = [
  { id: "owner", label: "Ring Your Phone", description: "Call forwards to your cell phone", icon: Phone, color: "text-primary", bgColor: "bg-primary/10" },
  {
    id: "ai",
    label: "AI receptionist",
    description: "Voice AI answers with your industry script, collects job details, can text you leads",
    icon: Bot,
    color: "text-chart-4",
    bgColor: "bg-chart-4/10",
  },
  { id: "voicemail", label: "Voicemail", description: "Send caller to voicemail", icon: Voicemail, color: "text-warning", bgColor: "bg-warning/10" },
]

export function DashboardPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  // Loads real rows from GET /api/calls (same source as Activity); polls every 25s so new calls appear without refresh.
  const { calls, quality, loading: opsLoading, loadError: opsLoadError, refreshing: opsRefreshing } = useOperationsData({
    refetchIntervalMs: 25_000,
  })
  // Counts by type for the four stat tiles (from the same loaded call list, up to API limit).
  const callStatsComputed = useMemo((): CallStat[] => {
    const incoming = calls.filter((c) => c.type === "incoming").length
    const outgoing = calls.filter((c) => c.type === "outgoing").length
    const missed = calls.filter((c) => c.type === "missed").length
    return [
      { label: "Total Calls", value: calls.length, icon: Phone, color: "text-primary", bgColor: "bg-primary/10" },
      { label: "Incoming", value: incoming, icon: PhoneIncoming, color: "text-success", bgColor: "bg-success/10" },
      { label: "Outgoing", value: outgoing, icon: PhoneOutgoing, color: "text-chart-2", bgColor: "bg-chart-2/10" },
      { label: "Missed", value: missed, icon: PhoneMissed, color: "text-destructive", bgColor: "bg-destructive/10" },
    ]
  }, [calls])
  // Sum talk time from duration_seconds on each log row for the summary card.
  const totalTalkTimeComputed = useMemo(() => {
    const totalSeconds = calls.reduce((sum, c) => sum + (c.durationSeconds || 0), 0)
    return { hours: Math.floor(totalSeconds / 3600), minutes: Math.floor((totalSeconds % 3600) / 60) }
  }, [calls])
  // At most 10 rows for the dashboard list; full history stays on Activity.
  const recentCallsSlice = useMemo(() => calls.slice(0, 10), [calls])
  // Used in the subtitle next to "Recent Calls".
  const todayCallCount = useMemo(() => calls.filter((c) => c.date === "Today").length, [calls])

  const [mainLinePhone, setMainLinePhone] = useState<string | null>(null)
  const [receptionists, setReceptionists] = useState<Contact[]>([])
  const [selectedReceptionistId, setSelectedReceptionistId] = useState<string | null>(null)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [fallback, setFallback] = useState<FallbackOption>("owner")
  /** AI fallback + no receptionist: ring owner cell before Voice AI (see Fallback Settings). */
  const [aiRingOwnerFirst, setAiRingOwnerFirst] = useState(false)
  const [showFallbackSettings, setShowFallbackSettings] = useState(false)

  // Add receptionist state
  const [showAddReceptionist, setShowAddReceptionist] = useState(false)
  const [newRecName, setNewRecName] = useState("")
  const [newRecPhone, setNewRecPhone] = useState("")
  const [addRecLoading, setAddRecLoading] = useState(false)
  const [addRecError, setAddRecError] = useState<string | null>(null)
  const [addRecSavedAt, setAddRecSavedAt] = useState<number | null>(null)
  const [deletingRecId, setDeletingRecId] = useState<string | null>(null)

  // AI assistant state
  const [hasTelnyxAiAssistant, setHasTelnyxAiAssistant] = useState(false)
  // Business numbers for showing which number routing applies to
  const [businessNumbers, setBusinessNumbers] = useState<DashboardBusinessNumber[]>([])

  // Wait until these complete before showing “Quick setup” — otherwise empty initial state looks
  // like an incomplete setup and the banner flashes away when APIs return (confusing on refresh).
  const [sessionFetchDone, setSessionFetchDone] = useState(false)
  const [receptionistsFetchDone, setReceptionistsFetchDone] = useState(false)
  const [numbersRoutingFetchDone, setNumbersRoutingFetchDone] = useState(false)
  const quickSetupDecided =
    sessionFetchDone && receptionistsFetchDone && numbersRoutingFetchDone

  // Fire session, receptionists, and numbers in parallel (single effect = one cleanup, faster wall-clock than chaining).
  useEffect(() => {
    let cancelled = false
    const safeFinally = (setter: () => void) => {
      if (!cancelled) setter()
    }

    fetch("/api/auth/session", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.data?.user?.phone) setMainLinePhone(data.data.user.phone)
      })
      .catch(() => {})
      .finally(() => safeFinally(() => setSessionFetchDone(true)))

    fetch("/api/receptionists", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((data) => {
        if (cancelled || !Array.isArray(data.data)) return
        setReceptionists(
          data.data.map((r: Record<string, string>) => ({
            id: r.id,
            name: r.name,
            phone: r.phone,
            initials: r.initials || r.name?.slice(0, 2)?.toUpperCase() || "??",
            color: r.color || "bg-primary",
          }))
        )
      })
      .catch(() => {})
      .finally(() => safeFinally(() => setReceptionistsFetchDone(true)))

    fetch("/api/numbers/mine", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { numbers: [] }))
      .then((data) => {
        if (cancelled || !Array.isArray(data.numbers)) {
          return Promise.resolve()
        }
        const active = data.numbers
          .filter((n: { status: string }) => n.status === "active")
          .map((n: Record<string, unknown>) => ({
            number: String(n.number),
            status: String(n.status),
            routing_summary: n.routing_summary as PhoneNumberRoutingSummary | undefined,
          }))
        setBusinessNumbers(active)

        const primaryNumber = active[0]?.number
        const routingUrl = primaryNumber
          ? `/api/routing?number=${encodeURIComponent(primaryNumber)}`
          : "/api/routing"

        return Promise.all([
          fetch(routingUrl, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
          fetch("/api/ai-assistant", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
        ])
          .then(([rData, aiData]) => {
            if (cancelled) return
            if (rData?.config) {
              setSelectedReceptionistId(rData.config.selected_receptionist_id || null)
              setFallback(rData.config.fallback_type || "owner")
              setAiRingOwnerFirst(Boolean(rData.config.ai_ring_owner_first))
            }
            if (aiData?.hasAssistant) setHasTelnyxAiAssistant(true)
          })
          .catch(() => {})
      })
      .catch(() => {})
      .finally(() => safeFinally(() => setNumbersRoutingFetchDone(true)))

    return () => {
      cancelled = true
    }
  }, [])

  // Bookmark / Settings link: /dashboard?ai=1 opens fallback sheet (playbook lives here now).
  useEffect(() => {
    if (searchParams.get("ai") !== "1") return
    setShowFallbackSettings(true)
    router.replace("/dashboard", { scroll: false })
  }, [searchParams, router])

  const ownerPhoneDisplay = formatPhoneDisplay(mainLinePhone)
  const selectedReceptionist = receptionists.find((c) => c.id === selectedReceptionistId) || null
  const isRoutingToOwner = !selectedReceptionist
  const hasBusinessNumbers = businessNumbers.length > 0
  const hasReceptionists = receptionists.length > 0
  const isSetupComplete = hasBusinessNumbers && (hasReceptionists || Boolean(mainLinePhone))

  // Save routing for the primary business number (or default if none).
  // When fallback_type is "ai", the API auto-provisions voice AI and returns voiceAi.
  function saveRouting(updates: Record<string, unknown>, opts?: { quiet?: boolean }): Promise<void> {
    const primaryNumber = businessNumbers[0]?.number || null
    return fetch("/api/routing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...updates, business_number: primaryNumber }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          config?: { fallback_type?: string; ai_ring_owner_first?: boolean }
          voiceAi?: { linked?: boolean; provisioned?: boolean; error?: string }
        }
        if (!res.ok) {
          if (!opts?.quiet) {
            toast({
              title: "Could not save routing",
              description: String(data.error || res.statusText || "Try again."),
              variant: "destructive",
            })
          }
          const primary = businessNumbers[0]?.number || null
          const routingUrl = primary
            ? `/api/routing?number=${encodeURIComponent(primary)}`
            : "/api/routing"
          void fetch(routingUrl, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((rData) => {
              if (rData?.config?.fallback_type) setFallback(rData.config.fallback_type || "owner")
              if (rData?.config?.ai_ring_owner_first !== undefined) {
                setAiRingOwnerFirst(Boolean(rData.config.ai_ring_owner_first))
              }
            })
          return
        }
        if (data.config?.ai_ring_owner_first !== undefined) {
          setAiRingOwnerFirst(Boolean(data.config.ai_ring_owner_first))
        }
        if (data.voiceAi?.linked) {
          setHasTelnyxAiAssistant(true)
        }
        if (data.voiceAi?.error) {
          toast({
            title: "Voice AI could not be created",
            description: String(data.voiceAi.error),
            variant: "destructive",
          })
        }
        if (!opts?.quiet) {
          if (data.voiceAi?.error) {
            /* destructive toast already shown */
          } else if (updates.fallback_type === "ai" && data.voiceAi?.provisioned) {
            toast({
              title: "AI receptionist ready",
              description: "Your voice assistant was created automatically. Tune the script below anytime.",
            })
          } else if (updates.fallback_type === "ai" && data.voiceAi?.linked) {
            toast({
              title: "AI fallback saved",
              description:
                "Your assistant is linked. Use “Ring my phone first” in Fallback Settings if you want your cell to ring before Voice AI.",
            })
          } else {
            toast({
              title: "Routing updated",
              description: "Incoming calls will follow your new routing rule.",
            })
          }
        }
        // Refresh per-number labels (AI fallback live, etc.) from the server.
        void fetch("/api/numbers/mine", { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .then((mine) => {
            if (!mine?.numbers || !Array.isArray(mine.numbers)) return
            const next = mine.numbers
              .filter((n: { status: string }) => n.status === "active")
              .map((n: Record<string, unknown>) => ({
                number: String(n.number),
                status: String(n.status),
                routing_summary: n.routing_summary as PhoneNumberRoutingSummary | undefined,
              }))
            setBusinessNumbers(next)
          })
          .catch(() => {})
      })
      .catch(() => {
        if (!opts?.quiet) {
          toast({
            title: "Network error",
            description: "Could not reach the server. Check your connection and try again.",
            variant: "destructive",
          })
        }
      })
  }

  function selectReceptionist(id: string) {
    setSelectedReceptionistId(id)
    setShowSwitcher(false)
    saveRouting({ selected_receptionist_id: id })
  }

  function clearReceptionist() {
    setSelectedReceptionistId(null)
    setShowSwitcher(false)
    saveRouting({ selected_receptionist_id: null })
  }

  async function handleAddReceptionist() {
    if (!newRecName.trim() || !newRecPhone.trim()) return
    setAddRecLoading(true)
    setAddRecError(null)
    try {
      const res = await fetch("/api/receptionists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newRecName.trim(), phone: newRecPhone.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAddRecError(data.error || "Failed to add receptionist")
        return
      }
      const r = data.data
      setReceptionists((prev) => [...prev, {
        id: r.id,
        name: r.name,
        phone: r.phone,
        initials: r.initials || r.name.slice(0, 2).toUpperCase(),
        color: r.color || "bg-primary",
      }])
      setNewRecName("")
      setNewRecPhone("")
      setShowAddReceptionist(false)
      setAddRecSavedAt(Date.now())
      toast({
        title: "Receptionist added",
        description: `${r.name} is ready for call routing.`,
      })
    } catch {
      setAddRecError("Something went wrong")
    } finally {
      setAddRecLoading(false)
    }
  }

  async function handleDeleteReceptionist(id: string) {
    if (!confirm("Remove this receptionist?")) return
    setDeletingRecId(id)
    try {
      const res = await fetch(`/api/receptionists/${id}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (res.ok) {
        const removed = receptionists.find((r) => r.id === id)
        setReceptionists((prev) => prev.filter((r) => r.id !== id))
        if (selectedReceptionistId === id) clearReceptionist()
        if (removed) {
          toast({
            title: "Receptionist removed",
            description: `${removed.name} will no longer receive routed calls.`,
          })
        }
      }
    } catch { /* silent */ }
    setDeletingRecId(null)
  }

  return (
    <div className="flex flex-col gap-5 p-4 pb-8">
      {quickSetupDecided && !isSetupComplete && (
        <section className="rounded-2xl border border-primary/25 bg-primary/8 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15">
              <Check className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Quick setup</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Complete these steps to go live fast.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                  <span className="text-xs text-foreground">1. Add a business number</span>
                  {hasBusinessNumbers ? (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Done</span>
                  ) : (
                    <a href="/dashboard/settings" className="text-[11px] font-semibold text-primary hover:underline">Open settings</a>
                  )}
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                  <span className="text-xs text-foreground">2. Add a receptionist (optional)</span>
                  {hasReceptionists ? (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Done</span>
                  ) : (
                    <button
                      onClick={() => { setShowAddReceptionist(true); setAddRecError(null) }}
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      Add now
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                  <span className="text-xs text-foreground">3. Choose where calls ring</span>
                  <button
                    onClick={() => setShowSwitcher(true)}
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    Set routing
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Routing Status */}
      <section className="zing-card relative p-6">
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            background:
              "radial-gradient(ellipse at 50% 0%, oklch(0.72 0.17 175 / 0.08) 0%, transparent 70%)",
          }}
        />
        <div className="relative flex flex-col items-center gap-5">
          {/* Centered icon */}
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-primary/60 bg-primary/10 shadow-[0_0_20px_-8px_var(--primary)]">
            <PhoneForwarded className="h-8 w-8 text-primary" />
          </div>

          {/* Status text + routing target */}
          <div className="flex flex-col items-center gap-2 text-center">
            <h2 className="text-xl font-semibold text-foreground">
              Calls Are Being Routed
            </h2>

            {/* Show which business number(s) this routing applies to */}
            {businessNumbers.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                {businessNumbers.map((bn) => {
                  const rs = bn.routing_summary
                  return (
                    <div
                      key={bn.number}
                      className="flex max-w-[11rem] flex-col items-center gap-1 rounded-xl border border-primary/20 bg-primary/5 px-2 py-1.5"
                    >
                      <span className="text-xs font-medium text-primary">{formatPhoneDisplay(bn.number)}</span>
                      {rs?.ai_fallback_live ? (
                        <span
                          title="AI fallback is on and your assistant is linked — callers should reach Voice AI. Use Fallback Settings → Ring my phone first to ring your cell before the assistant."
                          className="inline-flex items-center gap-0.5 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success"
                        >
                          <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                          AI fallback live
                        </span>
                      ) : rs?.ai_fallback_selected && !rs.telnyx_assistant_linked ? (
                        <span
                          title="AI is selected for this line but no assistant is linked yet — open AI fallback and save."
                          className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning"
                        >
                          AI — finish setup
                        </span>
                      ) : rs?.fallback_type === "voicemail" ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Voicemail fallback
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Ring phone fallback
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="relative flex flex-col items-center gap-2">
              <p className="text-sm text-muted-foreground">
                {isRoutingToOwner ? "Ringing directly to" : "Ringing first to"}
              </p>
              <button
                onClick={() => setShowSwitcher(!showSwitcher)}
                className={cn(
                  "flex items-center gap-2.5 rounded-full border px-4 py-2 transition-colors hover:bg-primary/15",
                  isRoutingToOwner
                    ? "border-border bg-secondary"
                    : "border-primary/30 bg-primary/10"
                )}
                aria-expanded={showSwitcher}
                aria-haspopup="listbox"
              >
                {isRoutingToOwner ? (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted-foreground/20">
                    <User className="h-3.5 w-3.5 text-foreground" />
                  </div>
                ) : (
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className={cn(selectedReceptionist!.color, "text-primary-foreground text-[10px] font-semibold")}>
                      {selectedReceptionist!.initials}
                    </AvatarFallback>
                  </Avatar>
                )}
                <span className={cn(
                  "text-base font-semibold",
                  isRoutingToOwner ? "text-foreground" : "text-primary"
                )}>
                  {isRoutingToOwner ? "Your Phone" : selectedReceptionist!.name}
                </span>
                <ChevronDown className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  showSwitcher && "rotate-180"
                )} />
              </button>
              <p className="text-xs text-muted-foreground">
                {isRoutingToOwner ? ownerPhoneDisplay : formatPhoneDisplay(selectedReceptionist!.phone)}
              </p>

              {/* Fallback when primary target does not answer (receptionist OR your phone) */}
              {(() => {
                const activeFallback = fallbackOptions.find((f) => f.id === fallback)!
                const FallbackIcon = activeFallback.icon
                return (
                  <button
                    type="button"
                    onClick={() => setShowFallbackSettings(true)}
                    className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2 transition-all hover:bg-secondary active:scale-[0.99]"
                  >
                    <FallbackIcon className={cn("h-3.5 w-3.5", activeFallback.color)} />
                    <p className="text-[11px] text-muted-foreground">
                      {"If no answer: "}
                      <span className="font-medium text-foreground">{activeFallback.label}</span>
                    </p>
                    <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
                  </button>
                )
              })()}

              {/* Switcher dropdown */}
              {showSwitcher && (
                <>
                  <div
                    className="fixed inset-0 z-[60] bg-background/60 backdrop-blur-sm"
                    onClick={() => setShowSwitcher(false)}
                    aria-hidden="true"
                  />
                  <div className="fixed inset-x-4 top-16 z-[70] mx-auto max-h-[calc(100dvh-5rem)] max-w-sm overflow-y-auto overscroll-contain rounded-2xl border border-border/70 bg-card pb-3 shadow-2xl [-webkit-overflow-scrolling:touch]">
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Route calls to
                      </span>
                      <button
                        onClick={() => setShowSwitcher(false)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                        aria-label="Close"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-col py-1" role="listbox" aria-label="Select who receives calls">
                      {/* Owner / default */}
                      <button
                        onClick={clearReceptionist}
                        role="option"
                        aria-selected={isRoutingToOwner}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 text-left transition-colors",
                          isRoutingToOwner ? "bg-secondary/50" : "hover:bg-secondary"
                        )}
                      >
                        <div className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-full",
                          isRoutingToOwner ? "bg-foreground/15" : "bg-muted-foreground/15"
                        )}>
                          <User className="h-4 w-4 text-foreground" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium leading-tight text-foreground">Your Phone</p>
                          <p className="text-[11px] text-muted-foreground">{ownerPhoneDisplay} (default)</p>
                        </div>
                        {isRoutingToOwner && (
                          <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold text-foreground">
                            Current
                          </span>
                        )}
                      </button>

                      <div className="mx-4 border-b border-border" />
                      <p className="px-4 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Receptionists
                      </p>

                      {receptionists.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-muted-foreground">
                          No receptionists added yet. Add one in Settings to route calls to them.
                        </p>
                      ) : receptionists.map((contact) => {
                        const isSelected = contact.id === selectedReceptionistId
                        return (
                          <button
                            key={contact.id}
                            onClick={() => selectReceptionist(contact.id)}
                            role="option"
                            aria-selected={isSelected}
                            className={cn(
                              "flex items-center gap-3 px-4 py-3 text-left transition-colors",
                              isSelected ? "bg-primary/5" : "hover:bg-secondary"
                            )}
                          >
                            <div className="relative">
                              <Avatar className="h-9 w-9">
                                <AvatarFallback className={cn(contact.color, "text-primary-foreground text-xs font-semibold")}>
                                  {contact.initials}
                                </AvatarFallback>
                              </Avatar>
                              {isSelected && (
                                <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success" />
                              )}
                            </div>
                            <div className="flex-1">
                              <p className={cn(
                                "text-sm font-medium leading-tight",
                                isSelected ? "text-primary" : "text-foreground"
                              )}>
                                {contact.name}
                              </p>
                              <p className="text-[11px] text-muted-foreground">{formatPhoneDisplay(contact.phone)}</p>
                            </div>
                            {isSelected && (
                              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                Active
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Fallback Settings Modal — z above header (z-40); top-16 clears app bar + safe area */}
            {showFallbackSettings && (
              <>
                <div
                  className="fixed inset-0 z-[60] bg-background/60 backdrop-blur-sm"
                  onClick={() => setShowFallbackSettings(false)}
                  aria-hidden="true"
                />
                <div
                  className={cn(
                    "fixed inset-x-4 top-16 z-[70] mx-auto max-h-[calc(100dvh-5rem)] w-full overflow-y-auto overscroll-contain rounded-2xl border border-border/70 bg-card pb-3 shadow-2xl [-webkit-overflow-scrolling:touch]",
                    fallback === "ai" ? "max-w-md" : "max-w-sm"
                  )}
                >
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Fallback Settings</h3>
                      <p className="text-[11px] text-muted-foreground">
                        {isRoutingToOwner
                          ? "What happens if your phone does not answer"
                          : `What happens if ${selectedReceptionist?.name.split(" ")[0]} doesn't answer`}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowFallbackSettings(false)}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                      aria-label="Close fallback settings"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex flex-col gap-1 p-2">
                    {fallbackOptions.map((option) => {
                      const Icon = option.icon
                      const isActive = fallback === option.id
                      return (
                        <button
                          key={option.id}
                          onClick={() => {
                            setFallback(option.id)
                            void saveRouting({ fallback_type: option.id })
                          }}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-3 py-3 text-left transition-all",
                            isActive
                              ? "bg-primary/5 ring-1 ring-primary/30"
                              : "hover:bg-secondary"
                          )}
                        >
                          <IconSurface className={cn("h-10 w-10", option.bgColor)}>
                            <Icon className={cn("h-5 w-5", option.color)} />
                          </IconSurface>
                          <div className="flex-1">
                            <p className="text-sm font-medium leading-tight text-foreground">
                              {option.label}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{option.description}</p>
                          </div>
                          {isActive && (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                              <Check className="h-3 w-3 text-primary-foreground" />
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* AI: playbook, opening line, voice — same sheet (no separate AI tab). */}
                  {fallback === "ai" && (
                    <div className="border-t border-border px-4 py-3">
                      {isRoutingToOwner ? (
                        <div className="mb-3 flex gap-3 rounded-xl border border-border/70 bg-secondary/25 p-3">
                          <Switch
                            id="zing-ai-ring-owner-first"
                            checked={aiRingOwnerFirst}
                            onCheckedChange={(on) => {
                              setAiRingOwnerFirst(on)
                              void saveRouting({ ai_ring_owner_first: on }, { quiet: true })
                            }}
                            className="mt-0.5 shrink-0"
                            aria-labelledby="zing-ai-ring-owner-first-label"
                          />
                          <div className="min-w-0 flex-1">
                            <label
                              id="zing-ai-ring-owner-first-label"
                              htmlFor="zing-ai-ring-owner-first"
                              className="text-xs font-semibold text-foreground"
                            >
                              Ring my phone first
                            </label>
                            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                              Callers hear normal ringing on your business line, then your cell rings for up to your ring
                              time. If you don&apos;t answer, Voice AI takes over — good for testing the full flow. Turn
                              off to connect straight to the assistant (default).
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="mb-3 text-[10px] text-muted-foreground">
                          Calls ring <span className="font-medium text-foreground">{selectedReceptionist?.name}</span>{" "}
                          first; if they don&apos;t answer, Voice AI runs. To ring your own phone before AI, clear the
                          active receptionist above.
                        </p>
                      )}
                      <AiIntakeFlowPanel
                        variant="modal"
                        aiNoAnswerSelected={fallback === "ai"}
                        externalAssistantLinked={hasTelnyxAiAssistant}
                        onHasAssistantChange={(active) => setHasTelnyxAiAssistant(active)}
                        onBusyGreetingSavedToRouting={(text) =>
                          saveRouting({ ai_greeting: text }, { quiet: true })
                        }
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Receptionists */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Receptionists
          </h3>
          <button
            onClick={() => { setShowAddReceptionist(true); setAddRecError(null) }}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>

        {receptionists.length === 0 && !showAddReceptionist ? (
          <EmptyState
            icon={<User className="h-8 w-8" />}
            title="No receptionists yet"
            description="Add a receptionist to route calls to them instead of your phone."
            action={(
              <button
                onClick={() => setShowAddReceptionist(true)}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Add Receptionist
              </button>
            )}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {receptionists.map((rec) => (
              <div
                key={rec.id}
                className="flex items-center justify-between rounded-xl border border-border bg-card p-3.5"
              >
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className={cn(rec.color, "text-primary-foreground text-xs font-semibold")}>
                      {rec.initials}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium text-foreground">{rec.name}</p>
                    <p className="text-[11px] text-muted-foreground">{formatPhoneDisplay(rec.phone)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedReceptionistId === rec.id && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      Active
                    </span>
                  )}
                  <button
                    onClick={() => handleDeleteReceptionist(rec.id)}
                    disabled={deletingRecId === rec.id}
                    className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    aria-label={`Remove ${rec.name}`}
                  >
                    {deletingRecId === rec.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add Receptionist form */}
        {showAddReceptionist && (
          <div className="mt-2 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground">Name</label>
                <input
                  type="text"
                  placeholder="Sarah Miller"
                  value={newRecName}
                  onChange={(e) => setNewRecName(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground">Phone number</label>
                <input
                  type="tel"
                  placeholder="(555) 234-5678"
                  value={newRecPhone}
                  onChange={(e) => setNewRecPhone(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </div>
              {addRecError && <p className="text-xs text-destructive">{addRecError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleAddReceptionist}
                  disabled={addRecLoading || !newRecName.trim() || !newRecPhone.trim()}
                  className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                >
                  {addRecLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Add"}
                </button>
                <button
                  onClick={() => { setShowAddReceptionist(false); setNewRecName(""); setNewRecPhone(""); setAddRecError(null) }}
                  disabled={addRecLoading}
                  className="rounded-xl border border-border px-4 py-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {addRecSavedAt && <p className="text-[11px] text-success">Saved just now</p>}
            </div>
          </div>
        )}
      </section>

      {/* AI Assistant */}
      <section>
        <div className="mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            AI Assistant
          </h3>
        </div>
        {hasTelnyxAiAssistant ? (
          <div className="rounded-xl border border-chart-4/20 bg-chart-4/5 p-4">
            <div className="flex items-center gap-3">
              <IconSurface tone="primary" className="h-10 w-10">
                <Sparkles className="h-5 w-5 text-chart-4" />
              </IconSurface>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">AI Receptionist Active</p>
                <p className="text-[11px] text-muted-foreground">
                  Voice AI when nobody picks up — industry intake, lead capture, optional SMS. Tune via{" "}
                  <span className="font-medium text-foreground">If no answer</span> → AI on this page.
                </p>
              </div>
              <span className="rounded-full bg-chart-4/10 px-2 py-0.5 text-[10px] font-semibold text-chart-4">
                On
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-chart-4/30 bg-chart-4/5 p-6 text-center">
            <Sparkles className="mx-auto mb-2 h-8 w-8 text-chart-4/60" />
            <p className="text-sm font-medium text-foreground">AI Receptionist</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Natural voice assistant with scripts for your trade (locksmith, plumbing, HVAC, and more). Saves leads and can text your cell.
            </p>
            <button
              type="button"
              onClick={() => setShowFallbackSettings(true)}
              className="mt-3 rounded-lg bg-chart-4 px-5 py-2 text-xs font-semibold text-white hover:bg-chart-4/90"
            >
              Open fallback settings
            </button>
          </div>
        )}
      </section>

      {/* Call Stats */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Call Stats
          </h3>
          <span className="text-xs text-muted-foreground">
            {opsRefreshing ? "Updating…" : "Live · same data as Activity"}
          </span>
        </div>
        <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
          These four tiles count your most recent call-log rows (up to 100). If you still see all zeros after real calls,
          your business line may not be hitting Zing (check number voice settings in your carrier or Zing setup) or the DB insert failed (see
          server logs for <span className="font-mono text-[10px]">Call log insert failed</span>).
        </p>
        {opsLoadError ? (
          <p className="mb-2 text-xs text-destructive">{opsLoadError}</p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {callStatsComputed.map((stat) => {
            const Icon = stat.icon
            return (
              <div
                key={stat.label}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5"
              >
                <IconSurface className={cn("h-10 w-10", stat.bgColor)}>
                  <Icon className={cn("h-5 w-5", stat.color)} />
                </IconSurface>
                <div>
                  <p className="text-lg font-bold text-foreground leading-tight">{stat.value}</p>
                  <p className="text-[11px] text-muted-foreground">{stat.label}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Talk Time Summary */}
        <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-card p-3.5">
          <div className="flex items-center gap-3">
            <IconSurface tone="warning" className="h-10 w-10">
              <Clock className="h-5 w-5 text-warning" />
            </IconSurface>
            <div>
              <p className="text-sm font-medium text-foreground">Total Talk Time</p>
              <p className="text-[11px] text-muted-foreground">Sum of durations in loaded calls</p>
            </div>
          </div>
          <div className="flex items-baseline gap-1 text-right">
            <span className="text-xl font-bold text-foreground">{totalTalkTimeComputed.hours}</span>
            <span className="text-xs text-muted-foreground">hr</span>
            <span className="text-xl font-bold text-foreground">{totalTalkTimeComputed.minutes}</span>
            <span className="text-xs text-muted-foreground">min</span>
          </div>
        </div>

        {/* Voice quality summary from /api/voice/quality when available (no fake trend %). */}
        {quality && quality.total_calls > 0 ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-success/5 px-3 py-2">
            <TrendingUp className="h-3.5 w-3.5 text-success" />
            <span className="text-xs text-success">
              {quality.answer_rate_percent}% answered (last 7 days) — see Activity for details
            </span>
          </div>
        ) : null}
      </section>

      {/* Recent Calls */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Recent Calls
          </h3>
          <span className="text-xs text-muted-foreground">
            {opsLoading && calls.length === 0
              ? "Loading…"
              : `${recentCallsSlice.length} shown · ${todayCallCount} today`}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {opsLoading && calls.length === 0 ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading call history…</span>
            </div>
          ) : recentCallsSlice.length === 0 ? (
            <EmptyState
              title="No calls yet"
              description="When your business line receives or places calls, they will show here and on Activity."
            />
          ) : (
            recentCallsSlice.map((call) => {
              const config = callTypeConfig[call.type]
              const TypeIcon = config.icon
              const routed = displayRoutedTo(call.routedTo)
              const durationLabel = formatDurationMmSs(call.durationSeconds)
              const primaryLine = call.callerName !== "Unknown Caller" ? call.callerName : call.callerNumber
              const showNumberOnSecondLine = call.callerName !== "Unknown Caller"
              return (
                <div
                  key={call.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full",
                        call.type === "missed"
                          ? "bg-destructive/10"
                          : call.type === "voicemail"
                            ? "bg-warning/10"
                            : call.type === "outgoing"
                              ? "bg-chart-2/10"
                              : "bg-success/10"
                      )}
                    >
                      <TypeIcon className={cn("h-4 w-4", config.color)} />
                    </div>
                    <div className="flex flex-col">
                      <p className="text-sm font-medium text-foreground leading-tight">{primaryLine}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {showNumberOnSecondLine ? (
                          <span className="text-[11px] text-muted-foreground">{call.callerNumber}</span>
                        ) : null}
                        {showNumberOnSecondLine && routed ? (
                          <span className="text-[11px] text-muted-foreground">{"·"}</span>
                        ) : null}
                        {routed ? (
                          <span className="text-[11px] text-primary/70">{"Routed to " + routed}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-[11px] text-muted-foreground">
                      {call.date} {call.time}
                    </span>
                    {durationLabel ? (
                      <span className="flex items-center gap-1 text-[11px] text-foreground/70">
                        <Clock className="h-3 w-3" />
                        {durationLabel}
                      </span>
                    ) : (
                      <span className="text-[11px] text-destructive">{config.label}</span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}
