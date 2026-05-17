"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bot, Phone, Users, Voicemail } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
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
    label: "Route to Step 4 AI Receptionist / Greetings Playbook",
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

export type DashboardRingBackupDrawerProps = {
  ringTimeoutSec: number
  setRingTimeoutSec: (n: number) => void
  fallback: FallbackOption
  setFallback: (f: FallbackOption) => void
  saveRouting: (updates: Record<string, unknown>, opts?: { quiet?: boolean }) => Promise<void>
  onClose: () => void
  onOpenVoiceAi: () => void
  routingBusinessNumber: string | null
  routingLineDetailLoading?: boolean
}

export function DashboardRingBackupDrawer({
  ringTimeoutSec,
  setRingTimeoutSec,
  fallback,
  setFallback,
  saveRouting,
  onClose,
  onOpenVoiceAi,
  routingBusinessNumber,
  routingLineDetailLoading,
}: DashboardRingBackupDrawerProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [draftSeconds, setDraftSeconds] = useState(ringTimeoutSec)
  const [draftStrategy, setDraftStrategy] = useState<BackupStrategy>(() => strategyFromFallback(fallback))
  const baselineRef = useRef("")

  useEffect(() => {
    const snapped = snapDashboardRingTimeoutSec(ringTimeoutSec)
    setDraftSeconds(snapped)
    setDraftStrategy(strategyFromFallback(fallback))
    baselineRef.current = JSON.stringify({ seconds: snapped, strategy: strategyFromFallback(fallback) })
  }, [ringTimeoutSec, fallback])

  const dirty = JSON.stringify({ seconds: draftSeconds, strategy: draftStrategy }) !== baselineRef.current

  const physicalRings = useMemo(() => estimatePhysicalRings(draftSeconds), [draftSeconds])
  const lineLabel = routingBusinessNumber ? `Line ${formatPhoneDisplay(routingBusinessNumber)}` : null

  const nearestPreset = useCallback((sec: number) => {
    let best = RING_PRESETS[0].seconds
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

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const snapped = snapDashboardRingTimeoutSec(draftSeconds)
      const nextFallback = fallbackFromStrategy(draftStrategy)
      setRingTimeoutSec(snapped)
      setFallback(nextFallback)
      await saveRouting({
        ring_timeout_seconds: snapped,
        fallback_type: nextFallback,
      })
      baselineRef.current = JSON.stringify({ seconds: snapped, strategy: draftStrategy })
      toast({ title: "Saved", description: "Ring timing and backup strategy updated." })
      onClose()
      if (draftStrategy === "ai") onOpenVoiceAi()
    } catch {
      toast({ title: "Could not save", description: "Try again in a moment.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }, [draftSeconds, draftStrategy, saveRouting, setRingTimeoutSec, setFallback, onClose, onOpenVoiceAi, toast])

  return (
    <>
      <DrawerStepHeader
        step="Step 3 · Timing & backup"
        title="Ring & Backup Config"
        subtitle="Define exactly how long lines ring before automated fallback systems execute."
        lineLabel={lineLabel}
      />
      <DrawerScrollBody className={cn(routingLineDetailLoading && "pointer-events-none opacity-50")}>
        <section className="space-y-4">
          <RingBudgetSummary physicalRings={physicalRings} draftSeconds={draftSeconds} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RING_PRESETS.map((preset) => {
              const active = nearestPreset(draftSeconds) === snapDashboardRingTimeoutSec(preset.seconds)
              return (
                <button
                  key={preset.seconds}
                  type="button"
                  onClick={() => setDraftSeconds(snapDashboardRingTimeoutSec(preset.seconds))}
                  className={cn(
                    "flex flex-col items-center rounded-xl border px-2 py-3 text-center transition-all duration-200",
                    active
                      ? "border-primary/60 bg-primary/10 shadow-[0_0_20px_-8px_var(--primary)]"
                      : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
                  )}
                >
                  <span className="text-sm font-bold text-foreground">{preset.label}</span>
                  <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">{preset.hint}</span>
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
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-primary"
            aria-label="Ring duration in seconds"
          />
          <div className="flex justify-between text-[10px] tabular-nums text-zinc-600">
            <span>{DASHBOARD_RING_TIMEOUT_CHOICES[0]}s</span>
            <span>{DASHBOARD_RING_TIMEOUT_CHOICES[DASHBOARD_RING_TIMEOUT_CHOICES.length - 1]}s</span>
          </div>
        </section>

        <section className="mt-8 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">If nobody picks up…</p>
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
                    "flex w-full items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-200",
                    active
                      ? "border-primary/60 bg-primary/10 shadow-[0_0_20px_-8px_var(--primary)]"
                      : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
                  )}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950/60">
                    <Icon className={cn("h-5 w-5", active ? "text-primary" : "text-zinc-500")} aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug text-foreground">{opt.label}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{opt.description}</p>
                  </div>
                  <RadioDot selected={active} />
                </button>
              )
            })}
          </div>
          {draftStrategy === "blast_team" ? (
            <p className="flex items-start gap-2 text-[11px] text-zinc-500">
              <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden />
              Rings your Step 2 primary first, then escalates using team contacts you configure.
            </p>
          ) : null}
          {draftStrategy === "ai" ? (
            <button
              type="button"
              onClick={onOpenVoiceAi}
              className="w-full rounded-lg border border-dashed border-primary/40 bg-primary/5 py-2.5 text-center text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              Open Step 4 Voice &amp; AI settings →
            </button>
          ) : null}
        </section>
      </DrawerScrollBody>
      <DrawerStickyFooter dirty={dirty} saving={saving} onSave={() => void handleSave()} onCancel={onClose} />
    </>
  )
}

function RingBudgetSummary({ physicalRings, draftSeconds }: { physicalRings: number; draftSeconds: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Ring budget</p>
      <p className="mt-1 text-lg font-semibold text-foreground">
        ~{physicalRings} physical rings{" "}
        <span className="text-base font-normal text-zinc-500">({draftSeconds}s on the line)</span>
      </p>
    </div>
  )
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <div
      className={cn(
        "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200",
        selected ? "border-primary bg-primary shadow-[0_0_12px_-2px_var(--primary)]" : "border-zinc-600"
      )}
      aria-hidden
    >
      {selected ? <span className="h-2 w-2 rounded-full bg-primary-foreground" /> : null}
    </div>
  )
}
