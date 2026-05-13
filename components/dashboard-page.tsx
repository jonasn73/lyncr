"use client"

import { useState, useEffect, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  Phone,
  PhoneForwarded,
  Voicemail,
  X,
  User,
  Bot,
  ChevronRight,
  Check,
  Loader2,
  Sparkles,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { IconSurface } from "@/components/ui/icon-surface"
import { Switch } from "@/components/ui/switch"
import { AiIntakeFlowPanel } from "@/components/ai-intake-flow-panel"
import type { PhoneNumberRoutingSummary } from "@/lib/types"

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

  // Save routing for the line shown in the UI (`routingBusinessNumber`), or the account default when you have no numbers yet.
  // When fallback_type is "ai", the API auto-provisions voice AI and returns voiceAi.
  function saveRouting(updates: Record<string, unknown>, opts?: { quiet?: boolean }): Promise<void> {
    const lineE164 = routingBusinessNumber
    return fetch("/api/routing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...updates, business_number: lineE164 }),
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
          const refetchNum = routingBusinessNumber
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
                  ? `Line ${formatPhoneDisplay(routingBusinessNumber)} will use this ring target and fallback.`
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
  }

  function selectReceptionist(id: string) {
    setSelectedReceptionistId(id)
    saveRouting({ selected_receptionist_id: id })
  }

  function clearReceptionist() {
    setSelectedReceptionistId(null)
    saveRouting({ selected_receptionist_id: null })
  }

  return (
    <div className="flex flex-col gap-5 p-4 pb-24">
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
                  <span className="text-xs text-foreground">2. Add people to route to (optional)</span>
                  {hasReceptionists ? (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Done</span>
                  ) : (
                    <Link href="/dashboard/contacts" className="text-[11px] font-semibold text-primary hover:underline">
                      Open Team
                    </Link>
                  )}
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                  <span className="text-xs text-foreground">3. Pick who answers below</span>
                  {hasBusinessNumbers ? (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Ready</span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Add a number first</span>
                  )}
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
        <div className="relative flex w-full max-w-lg mx-auto flex-col items-center gap-5">
          {/* Centered icon */}
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-primary/60 bg-primary/10 shadow-[0_0_20px_-8px_var(--primary)]">
            <PhoneForwarded className="h-8 w-8 text-primary" />
          </div>

          {/* Status text + routing target */}
          <div className="flex w-full flex-col items-center gap-2 text-center">
            <h2 className="text-xl font-semibold text-foreground">
              Calls Are Being Routed
            </h2>

            {/* Show which business number(s) this routing applies to */}
            {businessNumbers.length > 1 && (
              <p className="max-w-sm text-[11px] text-muted-foreground">
                Tap a number, then use the controls below — each line can ring your phone or a different receptionist.
              </p>
            )}

            {/* Show which business number(s) you own; with 2+ lines, tap to pick which routing block below applies to */}
            {businessNumbers.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
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
            )}

            <div className="relative w-full max-w-lg mx-auto flex flex-col gap-4">
              {businessNumbers.length > 1 && routingBusinessNumber ? (
                <p className="flex min-h-[1.25rem] items-center justify-center gap-1.5 text-center text-xs font-semibold text-primary">
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

              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">Who answers first?</p>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  Choose where this business line rings. Add people on{" "}
                  <Link href="/dashboard/contacts" className="font-semibold text-primary underline underline-offset-2">
                    Team
                  </Link>
                  {" "}— then pick them here (per line if you have more than one number).
                </p>
              </div>

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
                  onClick={() => clearReceptionist()}
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
                      onClick={() => selectReceptionist(contact.id)}
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
                <p className="text-center text-[11px] text-muted-foreground">
                  No team members yet — open{" "}
                  <Link href="/dashboard/contacts" className="font-semibold text-primary underline underline-offset-2">
                    Team
                  </Link>{" "}
                  to add someone you can route calls to.
                </p>
              ) : null}

              {(() => {
                const activeFallback = fallbackOptions.find((f) => f.id === fallback)!
                const FallbackIcon = activeFallback.icon
                return (
                  <button
                    type="button"
                    onClick={() => setShowFallbackSettings(true)}
                    className="flex w-full items-center gap-2 rounded-xl border border-border bg-secondary/50 px-4 py-3 transition-all hover:bg-secondary active:scale-[0.99]"
                  >
                    <FallbackIcon className={cn("h-4 w-4 shrink-0", activeFallback.color)} />
                    <p className="flex-1 text-left text-[11px] text-muted-foreground">
                      {"If no answer: "}
                      <span className="font-medium text-foreground">{activeFallback.label}</span>
                    </p>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                )
              })()}
            </div>

            {/* Fallback Settings Modal — high z-index so it sits above mobile nav */}
            {showFallbackSettings && (
              <>
                <div
                  className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-sm"
                  onClick={() => setShowFallbackSettings(false)}
                  aria-hidden="true"
                />
                <div
                  className={cn(
                    "fixed inset-x-4 top-14 z-[110] mx-auto max-h-[calc(100dvh-5rem)] w-full overflow-y-auto overscroll-contain rounded-2xl border border-border/70 bg-card pb-3 shadow-2xl [-webkit-overflow-scrolling:touch]",
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
                        {businessNumbers.length > 1 && routingBusinessNumber ? (
                          <span className="mt-0.5 block text-[10px] text-muted-foreground/90">
                            Applies to {formatPhoneDisplay(routingBusinessNumber)}
                          </span>
                        ) : null}
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
                          first; if they don&apos;t answer, Voice AI runs. To ring your own phone before AI, choose
                          <span className="font-medium text-foreground"> Your phone </span>
                          in the list above.
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

    </div>
  )
}
