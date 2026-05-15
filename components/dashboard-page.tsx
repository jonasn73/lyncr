"use client"

import { useState, useEffect, useRef, useCallback, memo, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  Phone,
  PhoneForwarded,
  Voicemail,
  User,
  Bot,
  Check,
  Loader2,
  Sparkles,
  Settings2,
  Activity,
  Clock,
  ChevronRight,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { IconSurface } from "@/components/ui/icon-surface"
import { Switch } from "@/components/ui/switch"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { PhoneNumberRoutingSummary } from "@/lib/types"
import { getAppSheetStory } from "@/components/app-sheet-stories"
import { StorySheetHeader } from "@/components/story-sheet-header"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import { StoryPopoverInfo } from "@/components/story-popover-info"

/** Ring timeout options in the dashboard (seconds); must match Telnyx `<Dial timeout>` sensible range. */
const DASHBOARD_RING_TIMEOUT_CHOICES = [10, 12, 15, 20, 25, 30, 35, 40, 45, 60] as const

function snapDashboardRingTimeoutSec(sec: number): (typeof DASHBOARD_RING_TIMEOUT_CHOICES)[number] {
  const clamped = Math.min(90, Math.max(10, Math.round(sec)))
  let best: (typeof DASHBOARD_RING_TIMEOUT_CHOICES)[number] = DASHBOARD_RING_TIMEOUT_CHOICES[0]
  let bestD = Infinity
  for (const n of DASHBOARD_RING_TIMEOUT_CHOICES) {
    const d = Math.abs(n - clamped)
    if (d < bestD) {
      best = n
      bestD = d
    }
  }
  return best
}

/** Last 10 US digits so we can match +1… vs 10-digit values from APIs without breaking line selection. */
function phoneDigits10(phone: string | null | undefined): string {
  if (phone == null || typeof phone !== "string") return ""
  const d = phone.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) return d.slice(-10)
  if (d.length >= 10) return d.slice(-10)
  return d
}

/** True when two stored phone strings refer to the same DID (handles +1 vs digits-only). */
function businessNumbersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return phoneDigits10(a) === phoneDigits10(b)
}

// Format E.164 to display, e.g. +15025551234 -> (502) 555-1234
function formatPhoneDisplay(phone: string | undefined | null): string {
  if (phone == null || typeof phone !== "string") return "Your cell"
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
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

const AiIntakeFlowPanelLazy = dynamic(
  () => import("@/components/ai-intake-flow-panel").then((mod) => mod.AiIntakeFlowPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground" role="status" aria-live="polite">
        <Loader2 className="h-7 w-7 shrink-0 animate-spin" aria-hidden />
        <span className="text-xs">Loading AI flow…</span>
      </div>
    ),
  }
)

const RoutingCallPathSheetHeader = memo(function RoutingCallPathSheetHeader({
  step,
  title,
  description,
}: {
  step: 1 | 2 | 3
  title: string
  description: ReactNode
}) {
  const lines: Record<1 | 2 | 3, string> = {
    1: "First ring — who picks up your business line.",
    2: "Still ringing — how long we wait before plan B.",
    3: "No answer — what the caller experiences next.",
  }
  return (
    <SheetHeader className="relative shrink-0 space-y-0 overflow-hidden border-b border-primary/25 bg-gradient-to-br from-primary/[0.18] via-card to-card px-4 pb-4 pt-2 text-left">
      <div className="mx-auto mb-2 h-1.5 w-11 shrink-0 rounded-full bg-foreground/25" aria-hidden />
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Incoming call path</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{lines[step]}</p>
      <div className="mt-2 flex gap-1" aria-hidden>
        {([1, 2, 3] as const).map((n) => (
          <span
            key={n}
            className={cn(
              "h-1 flex-1 rounded-full transition-[background-color,box-shadow] duration-200",
              n <= step ? "bg-primary shadow-[0_0_10px_-2px_var(--primary)]" : "bg-muted/70"
            )}
          />
        ))}
      </div>
      <SheetTitle className="mt-3 text-left text-lg font-semibold tracking-tight text-foreground">{title}</SheetTitle>
      <SheetDescription className="mt-2 text-left text-xs leading-relaxed text-muted-foreground">
        {description}
      </SheetDescription>
    </SheetHeader>
  )
})

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
    <div className="flex flex-col gap-5 p-4 pb-24">
      {quickSetupDecided && !isSetupComplete && (
        <section className="rounded-2xl border border-primary/25 bg-primary/8 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15">
              <Check className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">Quick setup</p>
                <SheetInfoTrigger
                  onPress={() => setDashboardStoryKey("dashboard-quick-setup")}
                  label="About Quick setup"
                  className="h-8 w-8 shrink-0"
                />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Start with a business line, then choose who answers and what happens if nobody picks up. Add teammates when
                you are ready.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <div
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border bg-card/70 px-3 py-2.5",
                    hasBusinessNumbers ? "border-border/70" : "border-primary/35 ring-1 ring-primary/15"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">1 · Business number</span>
                    {hasBusinessNumbers ? (
                      <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                        Done
                      </span>
                    ) : null}
                  </div>
                  {!hasBusinessNumbers ? (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Buy or port the number customers dial — routing and fallbacks apply to this line.
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
                    <Link href="/dashboard/settings#business-numbers" className="w-fit text-[11px] font-semibold text-primary hover:underline">
                      Manage numbers
                    </Link>
                  )}
                </div>

                <div
                  className={cn(
                    "flex flex-col gap-1.5 rounded-xl border border-border/70 bg-card/70 px-3 py-2",
                    !hasBusinessNumbers && "opacity-60"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">2 · Who answers</span>
                    {hasBusinessNumbers ? (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        Tap panels below
                      </span>
                    ) : (
                      <span className="shrink-0 text-[10px] text-muted-foreground">After step 1</span>
                    )}
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Ring your cell or a receptionist first, then set voicemail, AI, or owner backup below.
                  </p>
                  {hasBusinessNumbers ? (
                    <a
                      href="#routing-forward"
                      className="w-fit text-[11px] font-semibold text-primary hover:underline"
                    >
                      Jump to routing
                    </a>
                  ) : null}
                </div>

                <div
                  className={cn(
                    "flex items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2",
                    !hasBusinessNumbers && "opacity-60"
                  )}
                >
                  <span className="text-xs text-foreground">3 · Team (optional)</span>
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

      <div className="mx-auto w-full max-w-4xl space-y-5">
        {/* Routing Status */}
        <section id="routing-forward" className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-primary/[0.06] p-5 shadow-md ring-1 ring-border/40 sm:p-6">
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-90"
          style={{
            background:
              "radial-gradient(ellipse 120% 80% at 100% 0%, oklch(0.72 0.17 278 / 0.11) 0%, transparent 55%), radial-gradient(ellipse 80% 50% at 0% 100%, oklch(0.65 0.12 195 / 0.08) 0%, transparent 50%)",
          }}
        />
        <div className="relative flex w-full flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/35 bg-primary/12 shadow-[inset_0_1px_0_0_oklch(1_0_0/0.06)]">
                <PhoneForwarded className="h-6 w-6 text-primary" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight text-foreground">Call console</h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/12 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_10px_oklch(0.72_0.19_155_/_0.55)]" aria-hidden />
                    Live
                  </span>
                  <SheetInfoTrigger
                    onPress={() => setDashboardStoryKey("dashboard-call-console")}
                    label="About Call console"
                    className="h-8 w-8"
                  />
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Tap a card to open a sliding panel. Changes save as soon as you choose an option.
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
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <a
                href="#routing-lines"
                className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/90 px-3 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-secondary"
              >
                <PhoneForwarded className="h-3.5 w-3.5 text-primary" aria-hidden />
                Lines
              </a>
              <button
                type="button"
                onClick={() => setRingBackupOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/90 px-3 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-secondary"
              >
                <Clock className="h-3.5 w-3.5 text-primary" aria-hidden />
                Ring &amp; backup
              </button>
              <Link
                href="/dashboard/settings#business-numbers"
                className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/90 px-3 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-secondary"
              >
                <Settings2 className="h-3.5 w-3.5 text-primary" aria-hidden />
                Numbers
              </Link>
              <Link
                href="/dashboard/activity"
                className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/90 px-3 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-secondary"
              >
                <Activity className="h-3.5 w-3.5 text-primary" aria-hidden />
                Activity
              </Link>
            </div>
          </div>

          {businessNumbers.length > 1 && (
            <div className="flex max-w-xl flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                Tap a number, then a panel — each line can ring your phone or a different teammate.
              </p>
              <SheetInfoTrigger
                onPress={() => setDashboardStoryKey("dashboard-per-line-chips")}
                label="About multiple business lines"
                className="h-8 w-8 shrink-0"
              />
            </div>
          )}

          {businessNumbers.length > 0 && (
            <div id="routing-lines" className="flex flex-col gap-2">
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

          <div
            className={cn(
              "grid gap-2 sm:grid-cols-3",
              routingLineDetailLoading && "pointer-events-none opacity-50"
            )}
          >
            <button
              type="button"
              onClick={() => setWhoAnswersOpen(true)}
              className="group flex flex-col items-start gap-1 rounded-2xl border border-border/80 bg-background/80 p-4 text-left shadow-sm ring-1 ring-transparent transition-[transform,box-shadow,border-color] duration-200 hover:border-primary/35 hover:ring-primary/15 hover:shadow-md"
            >
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
                className="group flex h-full min-h-[8.5rem] w-full flex-col items-start gap-1 rounded-2xl border border-border/80 bg-background/80 p-4 text-left shadow-sm ring-1 ring-transparent transition-[transform,box-shadow,border-color] duration-200 hover:border-primary/35 hover:ring-primary/15 hover:shadow-md"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ring &amp; backup</span>
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
              className="group flex flex-col items-start gap-1 rounded-2xl border border-border/80 bg-background/80 p-4 text-left shadow-sm ring-1 ring-transparent transition-[transform,box-shadow,border-color] duration-200 hover:border-primary/35 hover:ring-primary/15 hover:shadow-md"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Voice &amp; greetings</span>
              <span className="text-base font-semibold text-foreground">AI script &amp; voicemail</span>
              <span className="text-[11px] text-muted-foreground">Playbook, opening line, ring-my-phone-first</span>
              <span className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary">
                Open panel
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </button>
          </div>
        </div>
        </section>

        <Sheet open={whoAnswersOpen} onOpenChange={setWhoAnswersOpen} modal>
        <SheetContent
          side="bottom"
          className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3"
        >
          <RoutingCallPathSheetHeader
            step={1}
            title="Who answers first?"
            description={
              <>
                Choose where this business line rings. Add people on{" "}
                <Link href="/dashboard/contacts" className="font-semibold text-primary underline underline-offset-2">
                  Team
                </Link>
                , then pick them here (per line if you have more than one number).
              </>
            }
          />
          <div className="flex justify-end border-b border-border/60 px-3 py-1">
            <StoryPopoverInfo storyKey="dashboard-sheet-who-answers" label="More about who answers first" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2 pt-2">
              <div
                className={cn(
                  "flex w-full flex-col gap-2",
                  routingLineDetailLoading && "pointer-events-none opacity-50"
                )}
                role="radiogroup"
                aria-label="Who answers calls to this business line"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={isRoutingToOwner}
                  onClick={() => {
                    clearReceptionist()
                    setWhoAnswersOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                    isRoutingToOwner
                      ? "border-primary bg-primary/8 ring-2 ring-primary/35"
                      : "border-border bg-card hover:bg-secondary"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      isRoutingToOwner ? "bg-foreground/15" : "bg-muted-foreground/15"
                    )}
                  >
                    <User className="h-5 w-5 text-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">Your phone</p>
                    <p className="text-[11px] text-muted-foreground">{ownerPhoneDisplay}</p>
                  </div>
                  {isRoutingToOwner ? (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
                      <Check className="h-3.5 w-3.5 text-primary-foreground" />
                    </div>
                  ) : null}
                </button>

                {receptionists.map((contact) => {
                  const picked = contact.id === selectedReceptionistId
                  return (
                    <button
                      key={contact.id}
                      type="button"
                      role="radio"
                      aria-checked={picked}
                      onClick={() => {
                        selectReceptionist(contact.id)
                        setWhoAnswersOpen(false)
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                        picked
                          ? "border-primary bg-primary/8 ring-2 ring-primary/35"
                          : "border-border bg-card hover:bg-secondary"
                      )}
                    >
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback
                          className={cn(contact.color, "text-primary-foreground text-xs font-semibold")}
                        >
                          {contact.initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-semibold", picked ? "text-primary" : "text-foreground")}>
                          {contact.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{formatPhoneDisplay(contact.phone)}</p>
                      </div>
                      {picked ? (
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
                          <Check className="h-3.5 w-3.5 text-primary-foreground" />
                        </div>
                      ) : null}
                    </button>
                  )
                })}
              </div>

              {receptionists.length === 0 ? (
                <p className="mt-3 text-center text-[11px] text-muted-foreground">
                  No team members yet — open{" "}
                  <Link href="/dashboard/contacts" className="font-semibold text-primary underline underline-offset-2">
                    Team
                  </Link>{" "}
                  to add someone you can route calls to.
                </p>
              ) : null}
            </div>
            <SheetFooter className="mt-auto flex shrink-0 flex-col gap-2 border-t border-border/70 bg-gradient-to-t from-secondary/30 to-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[10px] font-medium text-muted-foreground">Part 1 of 3 · same call story</p>
              <button
                type="button"
                onClick={() => {
                  setWhoAnswersOpen(false)
                  setRingBackupOpen(true)
                }}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90"
              >
                Next: ring time &amp; backup
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>

        <Sheet open={ringBackupOpen} onOpenChange={setRingBackupOpen} modal>
        <SheetContent side="bottom" className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3">
          <RoutingCallPathSheetHeader
            step={2}
            title="Ring time & backup"
            description="How long the first target rings, then what happens if nobody answers — so callers are never left hanging."
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              className={cn(
                "min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-2 pt-3",
                routingLineDetailLoading && "pointer-events-none opacity-50"
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="sigo-dash-ring-sec" className="text-[11px] text-muted-foreground">
                    Max ring time (first target)
                  </label>
                  <StoryPopoverInfo storyKey="dashboard-ring-timeout-deep" label="Explain max ring time" triggerClassName="h-7 w-7" />
                </div>
                <select
                  id="sigo-dash-ring-sec"
                  className="mt-1.5 w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  value={ringTimeoutSec}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!Number.isFinite(v)) return
                    setRingTimeoutSec(v)
                    void saveRouting({ ring_timeout_seconds: v })
                  }}
                >
                  {[...DASHBOARD_RING_TIMEOUT_CHOICES].map((n) => (
                    <option key={n} value={n}>
                      {n} seconds
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                  This does <span className="font-medium text-foreground">not</span> add a delay before ringing starts — Telnyx rings your team (or you) right away. It is only how many seconds to wait for someone to{" "}
                  <span className="font-medium text-foreground">answer</span> before Sigo runs your backup (voicemail, AI, or second number). Lower = faster switch to backup if nobody picks up.
                </p>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-foreground">If no answer</p>
                  <StoryPopoverInfo storyKey="dashboard-no-answer-backup" label="Explain if no answer options" triggerClassName="h-7 w-7" />
                </div>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="No-answer backup">
                  {fallbackOptions.map((opt) => {
                    const active = fallback === opt.id
                    const storyKey =
                      opt.id === "owner"
                        ? "dashboard-fallback-owner"
                        : opt.id === "ai"
                          ? "dashboard-fallback-ai"
                          : "dashboard-fallback-voicemail"
                    return (
                      <div key={opt.id} className="flex items-stretch gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            setFallback(opt.id)
                            void saveRouting({ fallback_type: opt.id })
                          }}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                            active
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border/80 bg-card text-foreground hover:bg-secondary"
                          )}
                        >
                          {opt.label}
                        </button>
                        <StoryPopoverInfo storyKey={storyKey} label={`About ${opt.label}`} triggerClassName="h-8 w-8 rounded-full" />
                      </div>
                    )
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRingBackupOpen(false)
                    setShowFallbackSettings(true)
                  }}
                  className="mt-4 w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 py-2.5 text-center text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10"
                >
                  Open full voice &amp; AI settings (part 3) →
                </button>
              </div>
            </div>
            <SheetFooter className="mt-auto flex shrink-0 flex-col gap-2 border-t border-border/70 bg-gradient-to-t from-secondary/30 to-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  setRingBackupOpen(false)
                  setWhoAnswersOpen(true)
                }}
                className="text-left text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                ← Back to who answers
              </button>
              <button
                type="button"
                onClick={() => {
                  setRingBackupOpen(false)
                  setShowFallbackSettings(true)
                }}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90"
              >
                Next: voice &amp; greetings
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>

        <Sheet open={showFallbackSettings} onOpenChange={setShowFallbackSettings} modal>
        <SheetContent
          side="bottom"
          className={cn("gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3", fallback === "ai" && "sm:max-w-xl")}
        >
          <RoutingCallPathSheetHeader
            step={3}
            title="Voice layer & greetings"
            description={
              <>
                {isRoutingToOwner
                  ? "If your phone does not answer, this is what happens next for the caller."
                  : `If ${selectedReceptionist?.name.split(" ")[0] ?? "your teammate"} doesn't answer, this is what happens next.`}
                {businessNumbers.length > 1 && routingBusinessNumber ? (
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Applies to {formatPhoneDisplay(routingBusinessNumber)}
                  </span>
                ) : null}
              </>
            }
          />
          <div className="flex justify-end border-b border-border/60 px-2 py-1">
            <StoryPopoverInfo storyKey="dashboard-sheet-voice-layer" label="More about voice and greetings" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="flex flex-col gap-1 p-2">
                {fallbackOptions.map((option) => {
                  const Icon = option.icon
                  const isActive = fallback === option.id
                  const storyKey =
                    option.id === "owner"
                      ? "dashboard-fallback-owner"
                      : option.id === "ai"
                        ? "dashboard-fallback-ai"
                        : "dashboard-fallback-voicemail"
                  return (
                    <div key={option.id} className="flex items-stretch gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setFallback(option.id)
                          void saveRouting({ fallback_type: option.id })
                        }}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-3 text-left transition-[background-color,box-shadow] duration-200",
                          isActive ? "bg-primary/5 ring-1 ring-primary/30" : "hover:bg-secondary"
                        )}
                      >
                        <IconSurface className={cn("h-10 w-10", option.bgColor)}>
                          <Icon className={cn("h-5 w-5", option.color)} />
                        </IconSurface>
                        <div className="flex-1">
                          <p className="text-sm font-medium leading-tight text-foreground">{option.label}</p>
                          <p className="text-[11px] text-muted-foreground">{option.description}</p>
                        </div>
                        {isActive && (
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
                            <Check className="h-3 w-3 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                      <StoryPopoverInfo storyKey={storyKey} label={`About ${option.label}`} triggerClassName="h-10 w-10 self-center rounded-lg" />
                    </div>
                  )
                })}
              </div>

              {fallback === "ai" && (
                <div className="border-t border-border px-4 py-3">
                  {isRoutingToOwner ? (
                    <div className="mb-3 flex gap-3 rounded-xl border border-border/70 bg-secondary/25 p-3">
                      <Switch
                        id="sigo-ai-ring-owner-first"
                        checked={aiRingOwnerFirst}
                        onCheckedChange={(on) => {
                          setAiRingOwnerFirst(on)
                          void saveRouting({ ai_ring_owner_first: on }, { quiet: true })
                        }}
                        className="mt-0.5 shrink-0"
                        aria-labelledby="sigo-ai-ring-owner-first-label"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <label
                            id="sigo-ai-ring-owner-first-label"
                            htmlFor="sigo-ai-ring-owner-first"
                            className="text-xs font-semibold text-foreground"
                          >
                            Ring my phone first
                          </label>
                          <StoryPopoverInfo
                            storyKey="dashboard-ai-ring-owner-first"
                            label="About ring my phone first"
                            triggerClassName="h-7 w-7 shrink-0"
                          />
                        </div>
                        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                          Callers hear normal ringing on your business line, then your cell rings for up to your ring time.
                          If you don&apos;t answer, Voice AI takes over — good for testing the full flow. Turn off to connect
                          straight to the assistant (default).
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="mb-3 text-[10px] text-muted-foreground">
                      Calls ring <span className="font-medium text-foreground">{selectedReceptionist?.name}</span> first; if
                      they don&apos;t answer, Voice AI runs. To ring your own phone before AI, open{" "}
                      <button
                        type="button"
                        className="font-medium text-primary underline underline-offset-2"
                        onClick={() => {
                          setShowFallbackSettings(false)
                          setWhoAnswersOpen(true)
                        }}
                      >
                        Who answers
                      </button>{" "}
                      and choose <span className="font-medium text-foreground">Your phone</span>.
                    </p>
                  )}
                  <AiIntakeFlowPanelLazy
                    variant="modal"
                    aiNoAnswerSelected={fallback === "ai"}
                    externalAssistantLinked={hasTelnyxAiAssistant}
                    onHasAssistantChange={(active) => setHasTelnyxAiAssistant(active)}
                    onBusyGreetingSavedToRouting={(text) => saveRouting({ ai_greeting: text }, { quiet: true })}
                  />
                </div>
              )}
            </div>
            <SheetFooter className="mt-auto flex shrink-0 flex-col gap-2 border-t border-border/70 bg-gradient-to-t from-secondary/30 to-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[10px] font-medium text-muted-foreground">Part 3 of 3 · closes the loop for callers</p>
              <button
                type="button"
                onClick={() => {
                  setShowFallbackSettings(false)
                  setRingBackupOpen(true)
                }}
                className="text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                ← Back to ring &amp; backup
              </button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>

        <section id="routing-tips" className="rounded-2xl border border-border/60 bg-muted/15 p-5">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Caller ID and spam labels</h2>
            <SheetInfoTrigger
              onPress={() => setDashboardStoryKey("dashboard-caller-id-tips")}
              label="About caller ID and spam labels"
              className="h-8 w-8 shrink-0"
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Forwarded legs use your Sigo business number. We also send your line label as the outbound display name when
            your carrier supports it, so the person answering may see a name instead of only digits. Labels like spam
            risk are added by the receiving carrier from their own analytics; improving reputation usually means setting
            CNAM on the number in Telnyx, registering it with services such as the Free Caller Registry, then carrying
            normal traffic for a few days.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Give each number a clear line label in{" "}
            <Link href="/dashboard/settings#business-numbers" className="font-semibold text-primary underline underline-offset-2">
              Settings
            </Link>{" "}
            — that label is what your team hears in the whisper (not your account business name).
          </p>
        </section>

      <Sheet open={dashboardStoryKey != null} onOpenChange={(open) => !open && setDashboardStoryKey(null)} modal>
        <SheetContent side="bottom" className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3">
          {(() => {
            const story = dashboardStoryKey ? getAppSheetStory(dashboardStoryKey) : null
            if (!dashboardStoryKey) return null
            if (!story) {
              return (
                <div className="p-6 text-sm text-muted-foreground">
                  No story is defined for this control yet.
                </div>
              )
            }
            return (
              <>
                <StorySheetHeader {...story} />
                <div className="border-t border-border/60 px-4 py-3">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Change routing on the cards above, or open{" "}
                    <Link href="/dashboard/settings" className="font-medium text-primary underline-offset-4 hover:underline">
                      Settings
                    </Link>{" "}
                    for numbers and whispers.
                  </p>
                </div>
                <SheetFooter className="border-t border-border/70 bg-secondary/15 px-4 py-3">
                  <p className="text-[11px] text-muted-foreground">
                    (i) inside open panels opens a compact popover so you can read help without closing your place in the flow.
                  </p>
                </SheetFooter>
              </>
            )
          })()}
        </SheetContent>
      </Sheet>
      </div>

    </div>
  )
}
