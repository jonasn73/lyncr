"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bot, Phone, PhoneIncoming, Users, Voicemail } from "lucide-react"
import { submitFormEvent } from "@/lib/form-keyboard"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { Switch } from "@/components/ui/switch"
import {
  DrawerScrollBody,
  DrawerStepHeader,
  DrawerStickyFooter,
} from "@/components/dashboard-routing-drawer-shared"
import {
  DASHBOARD_RING_TIMEOUT_CHOICES,
  formatPhoneDisplay,
  snapDashboardRingTimeoutSec,
  type FallbackOption,
} from "@/lib/dashboard-routing-utils"

const RING_PRESETS = [
  { seconds: 15, label: "15s", hint: "Short" },
  { seconds: 30, label: "30s", hint: "Standard" },
  { seconds: 45, label: "45s", hint: "Extended" },
  { seconds: 60, label: "60s", hint: "Long" },
] as const

type BackupStrategy = "ai" | "voicemail" | "blast_team"

function strategyFromFallback(fallback: FallbackOption): BackupStrategy {
  if (fallback === "ai") return "ai"
  if (fallback === "voicemail") return "voicemail"
  return "blast_team"
}

function fallbackFromStrategy(strategy: BackupStrategy): FallbackOption {
  if (strategy === "ai") return "ai"
  if (strategy === "voicemail") return "voicemail"
  return "owner"
}

function estimatePhysicalRings(seconds: number): number {
  return Math.max(1, Math.round(seconds / 5))
}

const BACKUP_OPTIONS: {
  value: BackupStrategy
  label: string
  description: string
  icon: typeof Bot
}[] = [
  {
    value: "ai",
    label: "AI receptionist",
    description: "Hands off to your Voice & AI settings after the ring timer expires.",
    icon: Bot,
  },
  {
    value: "voicemail",
    label: "Drop straight to traditional company voicemail",
    description: "Caller hears your greeting and can leave a message — no AI layer.",
    icon: Voicemail,
  },
  {
    value: "blast_team",
    label: "Simultaneously blast ring all team members",
    description: "Escalates through your primary contact, then additional team lines when configured.",
    icon: Users,
  },
]

const CALLER_EXPERIENCE_OPTIONS = [
  {
    value: true as const,
    label: "Greeting first",
    description: "Callers hear a short “Thank you for calling…” message, then we ring your team.",
    icon: PhoneIncoming,
  },
  {
    value: false as const,
    label: "Ring immediately",
    description: "Standard phone ringback while we connect — no spoken greeting before the ring.",
    icon: Phone,
  },
] as const

export type DashboardRingBackupDrawerProps = {
  ringTimeoutSec: number
  setRingTimeoutSec: (n: number) => void
  inboundCallerGreetingEnabled: boolean
  setInboundCallerGreetingEnabled: (v: boolean) => void
  /** When true, cell shows customer's number; when false, Lyncr business DID. */
  forwardOriginalCallerId: boolean
  setForwardOriginalCallerId: (v: boolean) => void
  fallback: FallbackOption
  setFallback: (f: FallbackOption) => void
  saveRouting: (updates: Record<string, unknown>, opts?: { quiet?: boolean }) => Promise<void>
  onClose: () => void
  onRegisterDiscard?: (discard: () => void) => void
  onOpenVoiceAi: () => void
  routingBusinessNumber: string | null
  routingLineDetailLoading?: boolean
}

export function DashboardRingBackupDrawer({
  ringTimeoutSec,
  setRingTimeoutSec,
  inboundCallerGreetingEnabled,
  setInboundCallerGreetingEnabled,
  forwardOriginalCallerId,
  setForwardOriginalCallerId,
  fallback,
  setFallback,
  saveRouting,
  onClose,
  onRegisterDiscard,
  onOpenVoiceAi,
  routingBusinessNumber,
  routingLineDetailLoading,
}: DashboardRingBackupDrawerProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [draftSeconds, setDraftSeconds] = useState(ringTimeoutSec)
  const [draftStrategy, setDraftStrategy] = useState<BackupStrategy>(() => strategyFromFallback(fallback))
  const [draftGreetingEnabled, setDraftGreetingEnabled] = useState(inboundCallerGreetingEnabled)
  // Draft for "Show Customer's Number" — saved with the rest of ring/backup settings.
  const [draftForwardCallerId, setDraftForwardCallerId] = useState(forwardOriginalCallerId)
  const baselineRef = useRef("")

  useEffect(() => {
    const snapped = snapDashboardRingTimeoutSec(ringTimeoutSec)
    setDraftSeconds(snapped)
    setDraftStrategy(strategyFromFallback(fallback))
    setDraftGreetingEnabled(inboundCallerGreetingEnabled)
    setDraftForwardCallerId(forwardOriginalCallerId)
    baselineRef.current = JSON.stringify({
      seconds: snapped,
      strategy: strategyFromFallback(fallback),
      greetingEnabled: inboundCallerGreetingEnabled,
      forwardCallerId: forwardOriginalCallerId,
    })
  }, [ringTimeoutSec, fallback, inboundCallerGreetingEnabled, forwardOriginalCallerId])

  const dirty =
    JSON.stringify({
      seconds: draftSeconds,
      strategy: draftStrategy,
      greetingEnabled: draftGreetingEnabled,
      forwardCallerId: draftForwardCallerId,
    }) !== baselineRef.current

  const physicalRings = useMemo(() => estimatePhysicalRings(draftSeconds), [draftSeconds])
  const lineLabel = routingBusinessNumber ? `Line ${formatPhoneDisplay(routingBusinessNumber)}` : null

  const nearestPreset = useCallback((sec: number) => {
    // Without the annotation this infers the literal 15 from RING_PRESETS[0], so
    // assigning any other preset below fails to compile.
    let best: (typeof RING_PRESETS)[number]["seconds"] = RING_PRESETS[0].seconds
    let bestD = Infinity
    for (const p of RING_PRESETS) {
      const d = Math.abs(p.seconds - sec)
      if (d < bestD) {
        best = p.seconds
        bestD = d
      }
    }
    return snapDashboardRingTimeoutSec(best)
  }, [])

  const discardEdits = useCallback(() => {
    try {
      const parsed = JSON.parse(baselineRef.current) as {
        seconds: number
        strategy: BackupStrategy
        greetingEnabled: boolean
        forwardCallerId: boolean
      }
      setDraftSeconds(parsed.seconds)
      setDraftStrategy(parsed.strategy)
      setDraftGreetingEnabled(parsed.greetingEnabled)
      setDraftForwardCallerId(Boolean(parsed.forwardCallerId))
    } catch {
      setDraftSeconds(snapDashboardRingTimeoutSec(ringTimeoutSec))
      setDraftStrategy(strategyFromFallback(fallback))
      setDraftGreetingEnabled(inboundCallerGreetingEnabled)
      setDraftForwardCallerId(forwardOriginalCallerId)
    }
  }, [ringTimeoutSec, fallback, inboundCallerGreetingEnabled, forwardOriginalCallerId])

  useEffect(() => {
    onRegisterDiscard?.(discardEdits)
  }, [onRegisterDiscard, discardEdits])

  const handleCancel = useCallback(() => {
    discardEdits()
    onClose()
  }, [discardEdits, onClose])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const snapped = snapDashboardRingTimeoutSec(draftSeconds)
      const nextFallback = fallbackFromStrategy(draftStrategy)
      setRingTimeoutSec(snapped)
      setFallback(nextFallback)
      setInboundCallerGreetingEnabled(draftGreetingEnabled)
      setForwardOriginalCallerId(draftForwardCallerId)
      await saveRouting({
        ring_timeout_seconds: snapped,
        fallback_type: nextFallback,
        inbound_caller_greeting_enabled: draftGreetingEnabled,
        forward_original_caller_id: draftForwardCallerId,
      })
      baselineRef.current = JSON.stringify({
        seconds: snapped,
        strategy: draftStrategy,
        greetingEnabled: draftGreetingEnabled,
        forwardCallerId: draftForwardCallerId,
      })
      toast({ title: "Saved", description: "Caller experience, ring timing, and backup strategy updated." })
      onClose()
      if (draftStrategy === "ai") onOpenVoiceAi()
    } catch {
      toast({ title: "Could not save", description: "Try again in a moment.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }, [
    draftSeconds,
    draftStrategy,
    draftGreetingEnabled,
    draftForwardCallerId,
    saveRouting,
    setRingTimeoutSec,
    setFallback,
    setInboundCallerGreetingEnabled,
    setForwardOriginalCallerId,
    onClose,
    onOpenVoiceAi,
    toast,
  ])

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        submitFormEvent(e)
        if (!saving) void handleSave()
      }}
    >
      <DrawerStepHeader
        title="Ring & Backup"
        subtitle="Caller experience, ring timing, and backup strategy."
        lineLabel={lineLabel}
      />
      <DrawerScrollBody className={cn(routingLineDetailLoading && "pointer-events-none opacity-50")}>
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What callers hear first</p>
          <div className="space-y-2">
            {CALLER_EXPERIENCE_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const active = draftGreetingEnabled === opt.value
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setDraftGreetingEnabled(opt.value)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border px-4 py-4 text-left transition-[border-color,background-color] duration-200",
                    active
                      ? "border-primary/60 bg-primary/10 shadow-[0_0_20px_-8px_var(--primary)]"
                      : "border-border bg-card/40 hover:border-border"
                  )}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background/60">
                    <Icon className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug text-foreground">{opt.label}</p>
                    <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{opt.description}</p>
                  </div>
                  <RadioDot selected={active} />
                </button>
              )
            })}
          </div>
        </section>

        <section className="mt-8 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caller ID on your cell</p>
          <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card/40 px-4 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-foreground">
                Show Customer&apos;s Number on Inbound Calls
              </p>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                When toggled OFF, inbound calls to your cell will display your Lyncr Business Number so you always know
                it&apos;s a business lead.
              </p>
            </div>
            <Switch
              checked={draftForwardCallerId}
              onCheckedChange={setDraftForwardCallerId}
              aria-label="Show customer's number on inbound calls"
              className="mt-0.5 shrink-0"
            />
          </div>
        </section>

        <section className="mt-8 space-y-4">
          <RingBudgetSummary physicalRings={physicalRings} draftSeconds={draftSeconds} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
            {RING_PRESETS.map((preset) => {
              const active = nearestPreset(draftSeconds) === snapDashboardRingTimeoutSec(preset.seconds)
              return (
                <button
                  key={preset.seconds}
                  type="button"
                  onClick={() => setDraftSeconds(snapDashboardRingTimeoutSec(preset.seconds))}
                  className={cn(
                    "flex flex-col items-center rounded-xl border px-2 py-3 text-center transition-[border-color,background-color,color] duration-200",
                    active
                      ? "border-primary/60 bg-primary/10 shadow-[0_0_20px_-8px_var(--primary)]"
                      : "border-border bg-card/40 hover:border-border"
                  )}
                >
                  <span className="text-sm font-bold text-foreground">{preset.label}</span>
                  <span className="mt-0.5 text-micro font-medium uppercase tracking-wide text-muted-foreground">{preset.hint}</span>
                </button>
              )
            })}
          </div>
          <input
            type="range"
            min={DASHBOARD_RING_TIMEOUT_CHOICES[0]}
            max={DASHBOARD_RING_TIMEOUT_CHOICES[DASHBOARD_RING_TIMEOUT_CHOICES.length - 1]}
            step={5}
            value={draftSeconds}
            onChange={(e) => setDraftSeconds(snapDashboardRingTimeoutSec(Number(e.target.value)))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            aria-label="Ring duration in seconds"
          />
          <div className="flex justify-between text-2xs tabular-nums text-muted-foreground">
            <span>{DASHBOARD_RING_TIMEOUT_CHOICES[0]}s</span>
            <span>{DASHBOARD_RING_TIMEOUT_CHOICES[DASHBOARD_RING_TIMEOUT_CHOICES.length - 1]}s</span>
          </div>
        </section>

        <section className="mt-8 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">If nobody picks up…</p>
          <div className="space-y-2">
            {BACKUP_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const active = draftStrategy === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDraftStrategy(opt.value)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border px-4 py-4 text-left transition-[border-color,background-color] duration-200",
                    active
                      ? "border-primary/60 bg-primary/10 shadow-[0_0_20px_-8px_var(--primary)]"
                      : "border-border bg-card/40 hover:border-border"
                  )}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background/60">
                    <Icon className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug text-foreground">{opt.label}</p>
                    <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{opt.description}</p>
                  </div>
                  <RadioDot selected={active} />
                </button>
              )
            })}
          </div>
          {draftStrategy === "blast_team" ? (
            <p className="flex items-start gap-2 text-2xs text-muted-foreground">
              <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              Rings your Step 2 primary first, then escalates using team contacts you configure.
            </p>
          ) : null}
          {draftStrategy === "ai" ? (
            <button
              type="button"
              onClick={onOpenVoiceAi}
              className="w-full rounded-lg border border-dashed border-primary/40 bg-primary/5 py-3 text-center text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              Open Step 4 Voice &amp; AI settings →
            </button>
          ) : null}
        </section>
      </DrawerScrollBody>
      <DrawerStickyFooter
        dirty={dirty}
        saving={saving}
        onSave={() => void handleSave()}
        onCancel={handleCancel}
        saveAsSubmit
      />
    </form>
  )
}

function RingBudgetSummary({ physicalRings, draftSeconds }: { physicalRings: number; draftSeconds: number }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 px-4 py-3">
      <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Ring budget</p>
      <p className="mt-1 text-lg font-semibold text-foreground">
        ~{physicalRings} physical rings{" "}
        <span className="text-base font-normal text-muted-foreground">({draftSeconds}s on the line)</span>
      </p>
    </div>
  )
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <div
      className={cn(
        "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200",
        selected ? "border-primary bg-primary shadow-[0_0_12px_-2px_var(--primary)]" : "border-border"
      )}
      aria-hidden
    >
      {selected ? <span className="h-2 w-2 rounded-full bg-primary-foreground" /> : null}
    </div>
  )
}
