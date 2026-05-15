"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  PhoneForwarded,
  Check,
  Loader2,
  Sparkles,
  Settings2,
  Activity,
  Clock,
  ChevronRight,
  ListOrdered,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import type { PhoneNumberRoutingSummary } from "@/lib/types"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import { DashboardRoutingSheets } from "@/components/dashboard-routing-sheets"
import { fallbackOptions } from "@/components/dashboard-routing-fallback-options"
import {
  businessNumbersMatch,
  formatPhoneDisplay,
  snapDashboardRingTimeoutSec,
  type Contact,
  type DashboardBusinessNumber,
  type FallbackOption,
} from "@/lib/dashboard-routing-utils"

/** After dismiss or auto-hide, the routing “Start here” intro stays hidden in this browser. */
const ROUTING_INTRO_DISMISSED_KEY = "zing_dash_routing_intro_dismissed_v1"

export function DashboardPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()

  const [mainLinePhone, setMainLinePhone] = useState<string | null>(null)
  const [receptionists, setReceptionists] = useState<Contact[]>([])
  const [selectedReceptionistId, setSelectedReceptionistId] = useState<string | null>(null)
  const [fallback, setFallback] = useState<FallbackOption>("owner")
  /** AI fallback + no receptionist: ring owner cell before Voice AI (see Fallback Settings). */
  const [aiRingOwnerFirst, setAiRingOwnerFirst] = useState(false)
  const [showFallbackSettings, setShowFallbackSettings] = useState(false)
  const [whoAnswersOpen, setWhoAnswersOpen] = useState(false)
  const [ringBackupOpen, setRingBackupOpen] = useState(false)
  /** Extra story sheet from Call console page-level (i) icons — stacks above routing sheets (z-[110]). */
  const [dashboardStoryKey, setDashboardStoryKey] = useState<string | null>(null)
  /** Ring duration for the first leg before no-answer fallback (from GET /api/routing). */
  const [ringTimeoutSec, setRingTimeoutSec] = useState(30)

  // AI assistant state
  const [hasTelnyxAiAssistant, setHasTelnyxAiAssistant] = useState(false)
  // Business numbers for showing which number routing applies to
  const [businessNumbers, setBusinessNumbers] = useState<DashboardBusinessNumber[]>([])
  // Which business line the dropdown + fallback controls edit (E.164); null = account default when you have no numbers yet
  const [routingBusinessNumber, setRoutingBusinessNumber] = useState<string | null>(null)
  // True while GET /api/routing for the tapped line is in flight (avoids showing the previous line’s target).
  const [routingLineDetailLoading, setRoutingLineDetailLoading] = useState(false)
  const routingFetchSeqRef = useRef(0)

  // Wait until these complete before showing “Quick setup” — otherwise empty initial state looks
  // like an incomplete setup and the banner flashes away when APIs return (confusing on refresh).
  const [sessionFetchDone, setSessionFetchDone] = useState(false)
  const [receptionistsFetchDone, setReceptionistsFetchDone] = useState(false)
  const [numbersRoutingFetchDone, setNumbersRoutingFetchDone] = useState(false)
  const quickSetupDecided =
    sessionFetchDone && receptionistsFetchDone && numbersRoutingFetchDone

  /** False until we read localStorage so the server and first client paint match. */
  const [routingIntroHydrated, setRoutingIntroHydrated] = useState(false)
  /** When true, the Start here header + optional success strip are hidden for this browser. */
  const [routingIntroDismissed, setRoutingIntroDismissed] = useState(false)

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
        // Keep the same selected line after refresh when possible; otherwise default to the first active number
        setRoutingBusinessNumber((prev) => {
          if (prev && active.some((x: DashboardBusinessNumber) => businessNumbersMatch(x.number, prev))) return prev
          return active[0]?.number ?? null
        })

        return fetch("/api/ai-assistant", { credentials: "include" }).then((r) => (r.ok ? r.json() : null))
          .then((aiData) => {
            if (cancelled) return
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

  // Restore intro visibility from localStorage so returning users do not see the onboarding strip again.
  useEffect(() => {
    try {
      setRoutingIntroDismissed(window.localStorage.getItem(ROUTING_INTRO_DISMISSED_KEY) === "1")
    } catch {
      setRoutingIntroDismissed(false)
    }
    setRoutingIntroHydrated(true)
  }, [])

  // Bookmark / Settings link: /dashboard?ai=1 opens fallback sheet (playbook lives here now).
  useEffect(() => {
    if (searchParams.get("ai") !== "1") return
    setShowFallbackSettings(true)
    router.replace("/dashboard", { scroll: false })
  }, [searchParams, router])

  // After numbers load or you tap a different line, pull effective routing (per-number row merged with account default).
  useEffect(() => {
    if (!numbersRoutingFetchDone) return
    const seq = ++routingFetchSeqRef.current
    setRoutingLineDetailLoading(true)
    let cancelled = false
    const num = routingBusinessNumber
    const routingUrl = num ? `/api/routing?number=${encodeURIComponent(num)}` : "/api/routing"
    fetch(routingUrl, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((rData) => {
        if (cancelled || seq !== routingFetchSeqRef.current) return
        if (rData?.config) {
          setSelectedReceptionistId(rData.config.selected_receptionist_id || null)
          setFallback(rData.config.fallback_type || "owner")
          setAiRingOwnerFirst(Boolean(rData.config.ai_ring_owner_first))
          const rt = rData.config.ring_timeout_seconds
          if (typeof rt === "number" && Number.isFinite(rt)) {
            setRingTimeoutSec(snapDashboardRingTimeoutSec(rt))
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled || seq !== routingFetchSeqRef.current) return
        setRoutingLineDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [numbersRoutingFetchDone, routingBusinessNumber])

  // If the selected line disappears (released number), snap back to the first remaining line.
  useEffect(() => {
    if (businessNumbers.length === 0) return
    if (
      !routingBusinessNumber
      || !businessNumbers.some((b) => businessNumbersMatch(b.number, routingBusinessNumber))
    ) {
      setRoutingBusinessNumber(businessNumbers[0].number)
    }
  }, [businessNumbers, routingBusinessNumber])

  const ownerPhoneDisplay = formatPhoneDisplay(mainLinePhone)
  const selectedReceptionist = receptionists.find((c) => c.id === selectedReceptionistId) || null
  const isRoutingToOwner = !selectedReceptionist
  const hasBusinessNumbers = businessNumbers.length > 0
  const hasReceptionists = receptionists.length > 0
  const isSetupComplete = hasBusinessNumbers && (hasReceptionists || Boolean(mainLinePhone))
  const activeFallbackMeta = fallbackOptions.find((o) => o.id === fallback)

  /** Persists “intro dismissed” so this browser does not show the Start here strip again. */
  const dismissRoutingIntro = useCallback(() => {
    try {
      window.localStorage.setItem(ROUTING_INTRO_DISMISSED_KEY, "1")
    } catch {
      // Storage can be blocked in private mode; still hide for this session.
    }
    setRoutingIntroDismissed(true)
  }, [])

  /** After setup completes, tuck the intro away automatically so the call flow is unobstructed. */
  useEffect(() => {
    if (!routingIntroHydrated || routingIntroDismissed) return
    if (!quickSetupDecided || !isSetupComplete) return
    const id = window.setTimeout(() => dismissRoutingIntro(), 3200)
    return () => window.clearTimeout(id)
  }, [
    routingIntroHydrated,
    routingIntroDismissed,
    quickSetupDecided,
    isSetupComplete,
    dismissRoutingIntro,
  ])

  // Save routing for the line shown in the UI (`routingBusinessNumber`), or the account default when you have no numbers yet.
  // When fallback_type is "ai", the API auto-provisions voice AI and returns voiceAi.
  // With **two or more** business lines, never send `business_number: null` for per-line fields — that only updated the
  // account default row and left the tapped line’s `routing_config` unchanged (calls still rang the wrong person).
  const saveRouting = useCallback(
    (updates: Record<string, unknown>, opts?: { quiet?: boolean }): Promise<void> => {
    const active = businessNumbers.filter((b) => b.status === "active")
    const lineE164 =
      (routingBusinessNumber && routingBusinessNumber.trim()) ||
      (active.length === 1 ? active[0]?.number?.trim() || null : null)
    const touchesPerLine =
      updates.selected_receptionist_id !== undefined ||
      updates.fallback_type !== undefined ||
      updates.ai_greeting !== undefined ||
      updates.ring_timeout_seconds !== undefined
    if (active.length >= 2 && touchesPerLine && !lineE164) {
      if (!opts?.quiet) {
        toast({
          title: "Pick a business line first",
          description: "Tap the number card for the line you want (green outline), then save again.",
          variant: "destructive",
        })
      }
      return Promise.reject(new Error("SIGO_NO_ROUTING_LINE"))
    }

    return fetch("/api/routing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...updates, business_number: lineE164 || null }),
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
          const refetchNum = lineE164 || routingBusinessNumber
          const routingUrl = refetchNum
            ? `/api/routing?number=${encodeURIComponent(refetchNum)}`
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
              description:
                businessNumbers.length > 1
                  ? `Line ${formatPhoneDisplay(lineE164 || routingBusinessNumber)} will use this ring target and fallback.`
                  : "Incoming calls will follow your new routing rule.",
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
  },
    [businessNumbers, routingBusinessNumber, toast]
  )

  const selectReceptionist = useCallback(
    (id: string) => {
      const active = businessNumbers.filter((b) => b.status === "active")
      if (active.length >= 2 && !routingBusinessNumber?.trim()) {
        toast({
          title: "Tap a business number first",
          description: "With two lines, tap the green number card for the line Sarah should answer, then tap Sarah again.",
          variant: "destructive",
        })
        return
      }
      const prev = selectedReceptionistId
      setSelectedReceptionistId(id)
      void saveRouting({ selected_receptionist_id: id }).catch((e) => {
        if (e instanceof Error && e.message === "SIGO_NO_ROUTING_LINE") setSelectedReceptionistId(prev)
      })
    },
    [businessNumbers, routingBusinessNumber, toast, saveRouting, selectedReceptionistId]
  )

  const clearReceptionist = useCallback(() => {
    const active = businessNumbers.filter((b) => b.status === "active")
    if (active.length >= 2 && !routingBusinessNumber?.trim()) {
      toast({
        title: "Tap a business number first",
        description: "Tap the line you want to route to your phone, then try again.",
        variant: "destructive",
      })
      return
    }
    const prev = selectedReceptionistId
    setSelectedReceptionistId(null)
    void saveRouting({ selected_receptionist_id: null }).catch((e) => {
      if (e instanceof Error && e.message === "SIGO_NO_ROUTING_LINE") setSelectedReceptionistId(prev)
    })
  }, [businessNumbers, routingBusinessNumber, toast, saveRouting, selectedReceptionistId])

  return (
    <div className="flex flex-col gap-8 px-4 pb-28 pt-1 sm:px-6">
      {routingIntroHydrated && !routingIntroDismissed ? (
        <div className="relative mx-auto w-full max-w-3xl space-y-4 rounded-2xl border border-border/60 bg-muted/15 p-4 shadow-sm sm:p-5">
          <button
            type="button"
            onClick={dismissRoutingIntro}
            className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
            aria-label="Dismiss getting started"
          >
            <X className="h-4 w-4 shrink-0" aria-hidden />
          </button>
          <header className="space-y-3 pr-10">
            <div className="flex items-center gap-2 text-primary">
              <ListOrdered className="h-4 w-4 shrink-0" aria-hidden />
              <p className="text-[11px] font-bold uppercase tracking-[0.18em]">Start here</p>
            </div>
            <h1 className="text-balance text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Who should answer your business line?
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
              Work top to bottom on this page: confirm your published number, choose who rings first, then set how long to
              wait and what happens next. Each card opens a side panel with the details.
            </p>
            <nav
              aria-label="Recommended order"
              className="flex flex-wrap items-center gap-x-1 gap-y-2 rounded-2xl border border-border/60 bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground sm:text-xs"
            >
              <span className="mr-1 font-semibold text-foreground">Order on this page:</span>
              <span className="rounded-md bg-background/90 px-2 py-1 ring-1 ring-border/80">1 · Your line</span>
              <ChevronRight className="mx-0.5 h-3 w-3 shrink-0 text-border" aria-hidden />
              <span className="rounded-md bg-background/90 px-2 py-1 ring-1 ring-border/80">2 · Who answers</span>
              <ChevronRight className="mx-0.5 h-3 w-3 shrink-0 text-border" aria-hidden />
              <span className="rounded-md bg-background/90 px-2 py-1 ring-1 ring-border/80">3 · Wait &amp; backup</span>
              <ChevronRight className="mx-0.5 h-3 w-3 shrink-0 text-border" aria-hidden />
              <span className="rounded-md bg-background/90 px-2 py-1 ring-1 ring-border/80">4 · Voice &amp; AI</span>
              <ChevronRight className="mx-0.5 h-3 w-3 shrink-0 text-border" aria-hidden />
              <a
                href="#routing-tips"
                className="rounded-md bg-background/90 px-2 py-1 ring-1 ring-border/80 transition-colors hover:bg-muted/60"
              >
                5 · Caller ID <span className="text-muted-foreground">(optional)</span>
              </a>
            </nav>
          </header>
          {quickSetupDecided && isSetupComplete ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-success/25 bg-success/5 px-4 py-3 text-xs leading-snug text-foreground sm:items-center sm:text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success sm:mt-0" aria-hidden />
              <p>
                <span className="font-semibold">You&apos;re set up.</span> Use the call flow below to change who answers or
                your backup anytime — same three cards, same order.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {quickSetupDecided && !isSetupComplete && (
        <section className="mx-auto w-full max-w-3xl rounded-2xl border border-border/80 bg-card p-4 shadow-sm ring-1 ring-primary/10 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12">
              <Check className="h-4 w-4 text-primary" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">Finish setup first</p>
                <SheetInfoTrigger
                  onPress={() => setDashboardStoryKey("dashboard-quick-setup")}
                  label="About setup checklist"
                  className="h-8 w-8 shrink-0"
                />
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Complete these in order. When your line is in place, use the call flow card below to choose who answers and
                what happens if nobody picks up.
              </p>
              <div className="mt-4 flex flex-col gap-2.5">
                <div
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border bg-background/60 px-3 py-2.5",
                    hasBusinessNumbers ? "border-border/70" : "border-primary/40 ring-1 ring-primary/15"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">1 · Business number</span>
                    {hasBusinessNumbers ? (
                      <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                        Done
                      </span>
                    ) : null}
                  </div>
                  {!hasBusinessNumbers ? (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Buy or port the number customers dial — routing applies to this line.
                    </p>
                  ) : null}
                  {!hasBusinessNumbers ? (
                    <Link
                      href="/dashboard/settings#business-numbers"
                      className="inline-flex w-fit items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      Add number in Settings
                    </Link>
                  ) : (
                    <Link
                      href="/dashboard/settings#business-numbers"
                      className="w-fit text-[11px] font-semibold text-primary hover:underline"
                    >
                      Manage numbers
                    </Link>
                  )}
                </div>

                <div
                  className={cn(
                    "flex flex-col gap-1.5 rounded-xl border border-border/70 bg-background/60 px-3 py-2",
                    !hasBusinessNumbers && "opacity-55"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">2 · Who answers</span>
                    {hasBusinessNumbers ? (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        Next — below
                      </span>
                    ) : (
                      <span className="shrink-0 text-[10px] text-muted-foreground">After step 1</span>
                    )}
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Ring your cell or a teammate first, then set voicemail, AI, or owner backup in the call flow card.
                  </p>
                  {hasBusinessNumbers ? (
                    <a href="#dash-call-flow" className="w-fit text-[11px] font-semibold text-primary hover:underline">
                      Go to call flow
                    </a>
                  ) : null}
                </div>

                <div
                  className={cn(
                    "flex items-center justify-between rounded-xl border border-border/70 bg-background/60 px-3 py-2",
                    !hasBusinessNumbers && "opacity-55"
                  )}
                >
                  <span className="text-xs font-medium text-foreground">3 · Team (optional)</span>
                  {hasReceptionists ? (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Added</span>
                  ) : hasBusinessNumbers ? (
                    <Link href="/dashboard/contacts" className="text-[11px] font-semibold text-primary hover:underline">
                      Open Team
                    </Link>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">After step 1</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="mx-auto w-full max-w-3xl space-y-6">
        {/* Call flow — one column of decisions; calmer surface than the old “console” hero. */}
        <section
          id="dash-call-flow"
          className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm ring-1 ring-border/30"
        >
          <div className="border-b border-border/60 bg-muted/15 px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
                  <PhoneForwarded className="h-5 w-5 text-primary" aria-hidden />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">Call flow</h2>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-success shadow-[0_0_8px_oklch(0.72_0.19_155_/_0.45)]"
                        aria-hidden
                      />
                      Live
                    </span>
                    <SheetInfoTrigger
                      onPress={() => setDashboardStoryKey("dashboard-call-flow")}
                      label="About call flow"
                      className="h-8 w-8"
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
                    Cards read left to right: who answers → how long to ring → voice / AI fallback. Tap a card to open its
                    panel.
                  </p>
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{isRoutingToOwner ? "Your phone" : selectedReceptionist?.name ?? "—"}</span>
                    <span className="mx-1.5 text-muted-foreground">·</span>
                    <span className="text-muted-foreground">rings up to</span>{" "}
                    <span className="font-semibold text-primary">{ringTimeoutSec}s</span>
                    <span className="mx-1.5 text-muted-foreground">·</span>
                    <span className="text-muted-foreground">then</span>{" "}
                    <span className="font-medium text-foreground">{activeFallbackMeta?.label ?? "Backup"}</span>
                  </p>
                </div>
              </div>
              <nav
                className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border/50 pt-3 text-[12px] sm:border-t-0 sm:pt-0"
                aria-label="Shortcuts"
              >
                <a href="#routing-lines" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                  <PhoneForwarded className="h-3.5 w-3.5" aria-hidden />
                  Lines
                </a>
                <button
                  type="button"
                  onClick={() => setRingBackupOpen(true)}
                  className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                >
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  Ring &amp; backup
                </button>
                <Link
                  href="/dashboard/settings#business-numbers"
                  className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                >
                  <Settings2 className="h-3.5 w-3.5" aria-hidden />
                  Numbers
                </Link>
                <Link href="/dashboard/activity" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                  <Activity className="h-3.5 w-3.5" aria-hidden />
                  Activity
                </Link>
              </nav>
            </div>
          </div>

          <div className="divide-y divide-border/60">
            {businessNumbers.length > 1 && (
              <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Step 1 · Line</p>
                  <p className="mt-0.5 max-w-xl text-[11px] leading-snug text-muted-foreground sm:text-xs">
                    Choose which published number you are editing — each line can ring a different person.
                  </p>
                </div>
                <SheetInfoTrigger
                  onPress={() => setDashboardStoryKey("dashboard-per-line-chips")}
                  label="About multiple business lines"
                  className="h-8 w-8 shrink-0"
                />
              </div>
            )}

            {businessNumbers.length > 0 && (
              <div id="routing-lines" className="px-4 py-4 sm:px-6">
                {businessNumbers.length > 1 ? (
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pick a line</p>
                ) : (
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your line</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {businessNumbers.map((bn) => {
                    const rs = bn.routing_summary
                    const ringId = rs?.ring_first_receptionist_id ?? null
                    const ringName = ringId ? receptionists.find((r) => r.id === ringId)?.name : null
                    const ringSummary = ringName ? `Rings: ${ringName}` : "Rings: Your phone"
                    const showLinePicker = businessNumbers.length > 1
                    const isLineSelected = showLinePicker && businessNumbersMatch(bn.number, routingBusinessNumber)
                    const cardClass = cn(
                      "flex max-w-[11rem] flex-col items-center gap-1 rounded-xl border px-2 py-1.5 transition-colors",
                      showLinePicker
                        ? cn(
                            "cursor-pointer hover:bg-primary/10",
                            isLineSelected
                              ? "border-primary ring-2 ring-primary/40 bg-primary/10"
                              : "border-primary/20 bg-primary/5"
                          )
                        : "border-primary/20 bg-primary/5"
                    )
                    const tags = (
                      <>
                        <span className="text-xs font-medium text-primary">{formatPhoneDisplay(bn.number)}</span>
                        <span className="text-[10px] font-medium leading-tight text-foreground/85">{ringSummary}</span>
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
                      </>
                    )
                    return showLinePicker ? (
                      <button
                        key={bn.number}
                        type="button"
                        className={cardClass}
                        onClick={() => setRoutingBusinessNumber(bn.number)}
                        aria-pressed={isLineSelected}
                      >
                        {tags}
                      </button>
                    ) : (
                      <div key={bn.number} className={cardClass}>
                        {tags}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {businessNumbers.length === 0 && quickSetupDecided && (
              <div className="px-4 py-6 text-center sm:px-6">
                <p className="text-sm font-medium text-foreground">No business line yet</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                  Add a number in Settings to unlock routing. Until then, callers cannot reach this account on a published
                  line.
                </p>
                <Link
                  href="/dashboard/settings#business-numbers"
                  className="mt-3 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Go to numbers
                </Link>
              </div>
            )}

            <div className="px-4 py-4 sm:px-6">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Steps 2–4 · Open in order
                  </p>
                  <p className="text-xs text-muted-foreground">Left → middle → right matches how a call is handled.</p>
                </div>
                {businessNumbers.length > 1 && routingBusinessNumber ? (
                  <p className="flex min-h-[1.25rem] items-center gap-1.5 text-xs font-semibold text-primary">
                    {routingLineDetailLoading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                        <span>Loading line…</span>
                      </>
                    ) : (
                      <span>Editing {formatPhoneDisplay(routingBusinessNumber)}</span>
                    )}
                  </p>
                ) : null}
              </div>

              <div
                className={cn(
                  "grid gap-3 sm:grid-cols-3",
                  routingLineDetailLoading && "pointer-events-none opacity-50"
                )}
              >
                <button
                  type="button"
                  onClick={() => setWhoAnswersOpen(true)}
                  className="group flex flex-col items-start gap-1 rounded-2xl border border-border/80 bg-background/90 p-4 text-left shadow-sm ring-1 ring-transparent transition-[transform,box-shadow,border-color] duration-200 hover:border-primary/40 hover:ring-primary/10 hover:shadow-md"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">A · Step 2</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Who answers</span>
                  <span className="text-base font-semibold text-foreground">
                    {isRoutingToOwner ? "Your phone" : selectedReceptionist?.name ?? "—"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {isRoutingToOwner ? ownerPhoneDisplay : formatPhoneDisplay(selectedReceptionist?.phone)}
                  </span>
                  <span className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary">
                    Open panel
                    <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </button>

                <div id="routing-ring-fallback" className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setRingBackupOpen(true)}
                    className="group flex h-full min-h-[9rem] w-full flex-col items-start gap-1 rounded-2xl border border-border/80 bg-background/90 p-4 text-left shadow-sm ring-1 ring-transparent transition-[transform,box-shadow,border-color] duration-200 hover:border-primary/40 hover:ring-primary/10 hover:shadow-md"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">B · Step 3</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Ring &amp; backup
                    </span>
                    <span className="text-base font-semibold text-foreground">{ringTimeoutSec}s</span>
                    <span className="text-[11px] text-muted-foreground">then {activeFallbackMeta?.label ?? "backup"}</span>
                    <span className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary">
                      Open panel
                      <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowFallbackSettings(true)}
                  className="group flex flex-col items-start gap-1 rounded-2xl border border-border/80 bg-background/90 p-4 text-left shadow-sm ring-1 ring-transparent transition-[transform,box-shadow,border-color] duration-200 hover:border-primary/40 hover:ring-primary/10 hover:shadow-md"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">C · Step 4</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Voice &amp; greetings
                  </span>
                  <span className="text-base font-semibold text-foreground">AI script &amp; voicemail</span>
                  <span className="text-[11px] text-muted-foreground">Playbook, opening line, ring-my-phone-first</span>
                  <span className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary">
                    Open panel
                    <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Sheets + caller-ID tips: tips render in document order first so they sit directly under call flow. */}
        <DashboardRoutingSheets
          whoAnswersOpen={whoAnswersOpen}
          setWhoAnswersOpen={setWhoAnswersOpen}
          ringBackupOpen={ringBackupOpen}
          setRingBackupOpen={setRingBackupOpen}
          showFallbackSettings={showFallbackSettings}
          setShowFallbackSettings={setShowFallbackSettings}
          dashboardStoryKey={dashboardStoryKey}
          setDashboardStoryKey={setDashboardStoryKey}
          receptionists={receptionists}
          selectedReceptionistId={selectedReceptionistId}
          isRoutingToOwner={isRoutingToOwner}
          ownerPhoneDisplay={ownerPhoneDisplay}
          selectedReceptionist={selectedReceptionist}
          clearReceptionist={clearReceptionist}
          selectReceptionist={selectReceptionist}
          routingLineDetailLoading={routingLineDetailLoading}
          ringTimeoutSec={ringTimeoutSec}
          setRingTimeoutSec={setRingTimeoutSec}
          saveRouting={saveRouting}
          fallback={fallback}
          setFallback={setFallback}
          aiRingOwnerFirst={aiRingOwnerFirst}
          setAiRingOwnerFirst={setAiRingOwnerFirst}
          hasTelnyxAiAssistant={hasTelnyxAiAssistant}
          setHasTelnyxAiAssistant={setHasTelnyxAiAssistant}
          businessNumbers={businessNumbers}
          routingBusinessNumber={routingBusinessNumber}
        />

        <section className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-4 py-4 text-center text-xs leading-relaxed text-muted-foreground sm:text-sm">
          <span className="font-medium text-foreground">Next elsewhere in the app:</span>{" "}
          <Link href="/dashboard/activity" className="font-semibold text-primary underline-offset-2 hover:underline">
            Activity &amp; recordings
          </Link>
          <span className="text-border"> · </span>
          <Link href="/dashboard/contacts" className="font-semibold text-primary underline-offset-2 hover:underline">
            Team
          </Link>
          <span className="text-border"> · </span>
          <Link href="/dashboard/settings" className="font-semibold text-primary underline-offset-2 hover:underline">
            Settings
          </Link>
        </section>
      </div>

    </div>
  )
}
