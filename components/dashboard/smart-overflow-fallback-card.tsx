"use client"

// Smart Overflow IVR Menu — Off-duty switch + capacity trigger + greetings entry.

import { memo } from "react"
import { Hourglass, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import { Switch } from "@/components/ui/switch"
import type { SmartOverflowConfig, SmartOverflowMode } from "@/lib/smart-overflow-autopilot"

export type SmartOverflowFallbackCardProps = {
  compact?: boolean
  step?: string
  overflowActive: boolean
  /** Presence On-Job / Closed — stronger amber glow on the automation path. */
  presenceDriven?: boolean
  nextAvailableSlotText: string
  confirmedJobsToday: number
  config: SmartOverflowConfig
  onConfigChange: (next: SmartOverflowConfig) => void
  /** Opens the Voice & AI / Greetings IVR editor. */
  onOpenScriptEditor: () => void
  loading?: boolean
  /** Live Retell webhook bridge health (legacy diagnostics when AI path still used). */
  retellConnected?: boolean
}

const MODE_OPTIONS: { id: SmartOverflowMode; label: string; hint: string }[] = [
  {
    id: "manual",
    label: "Manual Toggle",
    hint: "Turn on whenever you want to be off-duty.",
  },
  {
    id: "auto_capacity",
    label: "Auto-On Full Capacity",
    hint: "Activates when today’s confirmed jobs exceed your threshold.",
  },
]

export const SmartOverflowFallbackCard = memo(function SmartOverflowFallbackCard({
  compact = false,
  step = "3",
  overflowActive,
  presenceDriven = false,
  nextAvailableSlotText,
  confirmedJobsToday,
  config,
  onConfigChange,
  onOpenScriptEditor,
  loading = false,
  retellConnected = true,
}: SmartOverflowFallbackCardProps) {
  const title = overflowActive
    ? presenceDriven
      ? "📞 FALLBACK · AUTOMATION LIVE"
      : "📞 FALLBACK · IVR MENU ACTIVE"
    : "Smart Overflow IVR Menu"
  const value = overflowActive
    ? presenceDriven
      ? "[ IVR Menu LIVE · Presence ]"
      : "[ IVR Menu LIVE ]"
    : "IVR Menu standby"
  const detail = overflowActive
    ? presenceDriven
      ? "Presence On-Job / Closed — calls skip your cell and hit automation first"
      : "Inbound calls → automated greeting + press 1 / press 2 menu"
    : "Pick Manual or Auto-On Full Capacity below."
  const valueClass = overflowActive
    ? presenceDriven
      ? "animate-pulse text-amber-300"
      : "animate-pulse text-emerald-300"
    : "text-foreground"
  const liveChrome = overflowActive
    ? presenceDriven
      ? "border-amber-400/70 bg-amber-950/20 shadow-[0_0_28px_-4px_rgba(251,191,36,0.55)] ring-2 ring-amber-400/40"
      : "border-emerald-500/30 bg-emerald-950/10 shadow-[0_0_24px_-6px_rgba(16,185,129,0.35)]"
    : "border-slate-850/60 bg-slate-900/30"

  if (compact) {
    return (
      <div
        className={cn(
          "w-full rounded-xl border px-3 py-2.5 text-left transition-[box-shadow,border-color,background-color]",
          liveChrome,
          loading && "opacity-50"
        )}
      >
        <button
          type="button"
          onClick={onOpenScriptEditor}
          disabled={loading}
          className={cn("flex w-full items-center gap-3 text-left", MOBILE_TAP_TARGET)}
        >
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              overflowActive
                ? presenceDriven
                  ? "bg-amber-500/15 text-amber-300"
                  : "bg-emerald-500/15 text-emerald-300"
                : "bg-primary/12 text-primary"
            )}
          >
            <Hourglass className="h-3.5 w-3.5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </p>
            <p className={cn("truncate text-sm font-semibold", valueClass)}>{value}</p>
            <p className="truncate text-xs text-zinc-500">{detail}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
        </button>

        {overflowActive ? (
          <DiagnosticBadges
            nextAvailableSlotText={nextAvailableSlotText}
            retellConnected={retellConnected}
          />
        ) : null}

        <ModeControls
          compact
          config={config}
          confirmedJobsToday={confirmedJobsToday}
          onConfigChange={onConfigChange}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group relative flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border p-3 text-left shadow-sm transition-[box-shadow,border-color,background-color] sm:min-h-[12.5rem] sm:p-5",
        overflowActive
          ? presenceDriven
            ? "border-amber-400/70 bg-amber-950/15 shadow-[0_0_32px_-4px_rgba(251,191,36,0.55)] ring-2 ring-amber-400/35"
            : "border-emerald-500/30 bg-emerald-950/10 shadow-[0_0_24px_-6px_rgba(16,185,129,0.35)]"
          : "border-border/70 bg-gradient-to-b from-card to-background/80",
        loading && "pointer-events-none opacity-50"
      )}
    >
      <button
        type="button"
        onClick={onOpenScriptEditor}
        className="flex w-full flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
      >
        <div className="flex items-start justify-between gap-2">
          <div
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl border",
              overflowActive
                ? presenceDriven
                  ? "border-amber-400/40 bg-amber-500/15 shadow-[0_0_20px_-4px_rgba(251,191,36,0.65)]"
                  : "border-emerald-500/30 bg-emerald-500/15 shadow-[0_0_20px_-6px_rgb(16_185_129)]"
                : "border-primary/30 bg-primary/15 shadow-[0_0_20px_-6px_var(--primary)]"
            )}
          >
            <Hourglass
              className={cn(
                "h-5 w-5",
                overflowActive
                  ? presenceDriven
                    ? "text-amber-300"
                    : "text-emerald-300"
                  : "text-primary"
              )}
              aria-hidden
            />
          </div>
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              overflowActive
                ? presenceDriven
                  ? "text-amber-300/90"
                  : "text-emerald-300/80"
                : "text-primary/80"
            )}
          >
            Step {step}
          </span>
        </div>
        <div className="mt-3 flex flex-1 flex-col gap-0.5 sm:mt-4 sm:gap-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-[11px]">
            {title}
          </p>
          <p className={cn("text-base font-semibold leading-tight line-clamp-2 sm:text-lg md:text-xl", valueClass)}>
            {value}
          </p>
          <p className="text-xs text-zinc-500 line-clamp-2">{detail}</p>
        </div>
      </button>

      {overflowActive ? (
        <DiagnosticBadges
          nextAvailableSlotText={nextAvailableSlotText}
          retellConnected={retellConnected}
        />
      ) : null}

      <ModeControls
        config={config}
        confirmedJobsToday={confirmedJobsToday}
        onConfigChange={onConfigChange}
      />

      <button
        type="button"
        onClick={onOpenScriptEditor}
        className={cn(
          "mt-3 inline-flex w-full items-center justify-center rounded-lg border border-border/70 bg-transparent px-4 text-xs font-semibold text-muted-foreground transition-[border-color,background-color,color] duration-200 sm:mt-4",
          MOBILE_TAP_TARGET,
          "hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-200"
        )}
      >
        Edit IVR greetings
      </button>
    </div>
  )
})

function DiagnosticBadges({
  nextAvailableSlotText,
  retellConnected = true,
}: {
  nextAvailableSlotText: string
  retellConnected?: boolean
}) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <span className="inline-flex w-fit items-center rounded border border-teal-900 bg-teal-950 px-2 py-0.5 text-[10px] font-semibold text-teal-400">
        IVR Menu Live · /api/telnyx-menu
      </span>
      <span
        className={cn(
          "inline-flex w-fit max-w-full items-center truncate rounded border px-2 py-0.5 text-[10px] font-semibold",
          retellConnected
            ? "border-emerald-900/80 bg-emerald-950/60 text-emerald-300"
            : "border-amber-900/80 bg-amber-950/50 text-amber-300"
        )}
      >
        {retellConnected
          ? "Routing: Off-duty → keypad menu"
          : "Routing: Waiting / menu endpoint check"}
      </span>
      <span className="inline-flex w-fit max-w-full items-center truncate rounded border border-slate-800 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
        Offering: {nextAvailableSlotText}
      </span>
    </div>
  )
}

function ModeControls({
  compact = false,
  config,
  confirmedJobsToday,
  onConfigChange,
}: {
  compact?: boolean
  config: SmartOverflowConfig
  confirmedJobsToday: number
  onConfigChange: (next: SmartOverflowConfig) => void
}) {
  return (
    <div className={cn("mt-3 space-y-2 border-t border-white/5 pt-3", compact && "pt-2")}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        IVR trigger
      </p>
      <div className="flex flex-col gap-1.5">
        {MODE_OPTIONS.map((opt) => {
          const active = config.mode === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onConfigChange({ ...config, mode: opt.id })}
              className={cn(
                "rounded-lg border px-2.5 py-2 text-left transition-colors",
                active
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
              )}
            >
              <p className="text-[11px] font-semibold text-foreground">{opt.label}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">{opt.hint}</p>
            </button>
          )
        })}
      </div>

      {config.mode === "manual" ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-2.5 py-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-foreground">Off-duty now</p>
            <p className="text-[10px] text-zinc-500">
              Manual Toggle · Automated IVR menu takes overflow calls
            </p>
          </div>
          <Switch
            checked={config.manualEnabled}
            onCheckedChange={(on) => onConfigChange({ ...config, manualEnabled: on })}
            aria-label="Off-duty IVR menu toggle"
            className="shrink-0 data-[state=checked]:bg-emerald-500"
          />
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-2.5 py-2">
          <label className="flex items-center justify-between gap-2 text-[11px] font-semibold text-foreground">
            Capacity threshold
            <input
              type="number"
              min={1}
              max={40}
              value={config.capacityThreshold}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  capacityThreshold: Math.max(1, Math.min(40, Number(e.target.value) || 1)),
                })
              }
              className="w-14 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-center text-xs tabular-nums text-foreground"
            />
          </label>
          <p className="mt-1 text-[10px] text-zinc-500">
            Today: {confirmedJobsToday} confirmed · trips when &gt; {config.capacityThreshold}
          </p>
        </div>
      )}
    </div>
  )
}
