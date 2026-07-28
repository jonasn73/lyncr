"use client"

// Sticky Presence bar on Lines — Available / Busy + Smart Busy capacity control.

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  isBusyPresenceStatus,
  PRESENCE_BUSY_WRITE_STATUS,
  type PresenceStatus,
} from "@/lib/account-presence"
import { useAccountPresence } from "@/components/dashboard/account-presence-context"
import { useSmartBusy } from "@/hooks/use-smart-busy"
import {
  LINES_MOBILE_CARD,
  LINES_MOBILE_PAGE_X,
  LINES_MOBILE_SECTION_LABEL,
} from "@/lib/mobile-shell"

type PresenceUiOption = {
  /** Value sent to the API (Busy always writes ON_JOB). */
  write: PresenceStatus
  label: string
  hint: string
  /** Whether this option should look selected for the current DB status. */
  isActive: (status: PresenceStatus) => boolean
}

const OPTIONS: PresenceUiOption[] = [
  {
    write: "AVAILABLE",
    label: "Available",
    hint: "Your phone rings first",
    isActive: (s) => s === "AVAILABLE",
  },
  {
    write: PRESENCE_BUSY_WRITE_STATUS,
    label: "Busy",
    hint: "Skip your phone → booking text",
    isActive: (s) => isBusyPresenceStatus(s),
  },
]

export function PresenceStatusBar({ className }: { className?: string }) {
  const { presenceStatus, presenceReady, loading, saving, setPresenceStatus } = useAccountPresence()
  const smartBusy = useSmartBusy()

  return (
    <div
      className={cn(
        "w-full border-b border-zinc-800/90 bg-slate-950/95 py-2.5",
        LINES_MOBILE_PAGE_X,
        className
      )}
      aria-label="Presence status"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className={LINES_MOBILE_SECTION_LABEL}>Presence</p>
        {/* Fixed spinner slot so the label row doesn’t jump when loading toggles. */}
        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
          {loading || saving || smartBusy.saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
          ) : null}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((opt) => {
          // Until cache/API lands, keep both chips muted — never flash Available then Busy.
          const active = presenceReady && opt.isActive(presenceStatus)
          return (
            <button
              key={opt.label}
              type="button"
              // Only block taps while saving — loading must not freeze/flash the chips on refresh.
              disabled={saving || smartBusy.saving}
              onClick={() => {
                // Manual Available while full → suppress Smart Busy re-engage.
                if (opt.write === "AVAILABLE" && smartBusy.atCapacity && smartBusy.smartBusyEnabled) {
                  void smartBusy.revertToAvailable()
                  return
                }
                // Manual Busy is not a Smart Busy engagement.
                if (opt.write === PRESENCE_BUSY_WRITE_STATUS) {
                  void setPresenceStatus(opt.write)
                  return
                }
                void setPresenceStatus(opt.write)
              }}
              className={cn(
                "flex min-h-[3.25rem] flex-col items-center justify-center px-2 py-2 text-center transition-colors",
                LINES_MOBILE_CARD,
                active
                  ? opt.write === "AVAILABLE"
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                    : "border-amber-500/50 bg-amber-500/15 text-amber-100"
                  : "text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              )}
            >
              <span className="text-sm font-semibold leading-tight">{opt.label}</span>
              <span
                className={cn(
                  "mt-0.5 text-[10px] leading-tight",
                  active ? "text-current/70" : "text-zinc-500"
                )}
              >
                {opt.hint}
              </span>
            </button>
          )
        })}
      </div>

      {/* Smart Busy toggle — auto-engage Busy when calendar + pool are over threshold. */}
      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-2.5 py-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-zinc-200">Smart Busy</p>
          <p className="text-[10px] leading-snug text-zinc-500">
            Auto Busy when full · {smartBusy.capacitySummary}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={smartBusy.smartBusyEnabled}
          disabled={smartBusy.saving}
          onClick={() => void smartBusy.setSmartBusyEnabled(!smartBusy.smartBusyEnabled)}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full transition-colors",
            smartBusy.smartBusyEnabled ? "bg-amber-500/80" : "bg-zinc-700"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
              smartBusy.smartBusyEnabled ? "left-5" : "left-0.5"
            )}
          />
        </button>
      </div>

      {/* Recommend banner when full and still Available. */}
      {smartBusy.recommendBusy ? (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-amber-100">
              Calendar full — Busy recommended
            </p>
            <p className="text-[10px] text-amber-100/70">{smartBusy.capacitySummary}</p>
          </div>
          <button
            type="button"
            disabled={smartBusy.saving}
            onClick={() => void smartBusy.enableBusy()}
            className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-md bg-amber-500/90 px-3 text-[11px] font-semibold text-zinc-950 hover:bg-amber-400"
          >
            Enable Busy
          </button>
        </div>
      ) : null}

      {/* Engaged / Busy-via-Smart notice with one-tap revert. */}
      {smartBusy.smartBusyEngaged && isBusyPresenceStatus(presenceStatus) ? (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-amber-500/35 bg-amber-950/30 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-amber-100/90">
            Smart Busy on — callers get booking text instead of ringing your phone.
          </p>
          <button
            type="button"
            disabled={smartBusy.saving}
            onClick={() => void smartBusy.revertToAvailable()}
            className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/25"
          >
            Back to Available
          </button>
        </div>
      ) : null}
    </div>
  )
}
