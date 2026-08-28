"use client"

// Compact Available toggle — sits under Alerts with Caller ID on Lines.
// On = Available (cell rings first). Off = Busy (skip phone → booking text).
// Shows Amber “Busy until …” when set by text. Uses plain-button Switch (not Radix).

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import {
  isBusyPresenceStatus,
  PRESENCE_BUSY_WRITE_STATUS,
} from "@/lib/account-presence"
import { formatAmberUntilLabel } from "@/lib/amber-commands"
import { useAccountPresence } from "@/components/dashboard/account-presence-context"

export function PresenceStatusBar({ className }: { className?: string }) {
  const {
    presenceStatus,
    presenceReady,
    presenceAvailableAt,
    presenceTimezone,
    loading,
    saving,
    setPresenceStatus,
  } = useAccountPresence()

  // Available = switch on; Busy (ON_JOB / CLOSED) = switch off.
  const isAvailable = presenceReady && presenceStatus === "AVAILABLE"
  const isBusy = presenceReady && isBusyPresenceStatus(presenceStatus)
  const busySaving = saving || loading

  let untilLabel: string | null = null
  if (isBusy && presenceAvailableAt) {
    const at = new Date(presenceAvailableAt)
    if (!Number.isNaN(at.getTime()) && at.getTime() > Date.now()) {
      untilLabel = formatAmberUntilLabel(at, presenceTimezone || "America/New_York")
    }
  }

  return (
    <section
      className={cn(
       "w-full rounded-2xl border px-4 py-4 sm:px-6",
        // Fixed min height covers Available + Busy subtitle + one desktop note line.
        "min-h-[5.75rem] md:min-h-[6.75rem]",
        isBusy
          ? "border-amber-400/80 bg-amber-500/10"
          : "border-border/60 bg-muted/15",
        className
      )}
      aria-label="Presence status"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <label
              htmlFor="presence-available-toggle"
              className="block cursor-pointer text-xs font-semibold text-slate-200"
            >
              Available
            </label>
            {/* Spinner while loading or saving — same cue as the old dual-button bar. */}
            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
              {busySaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : null}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
            {isBusy
              ? untilLabel
                ? `Busy until ${untilLabel} · skip your phone`
                : "Skip your phone → Available team, then hold queue"
              : "Your phone rings first"}
          </p>
          {/* Desktop-only notes — hide long copy on mobile. */}
          {isAvailable ? (
            <p className="mt-1 hidden text-[10px] leading-snug text-muted-foreground md:block">
              If you&apos;re already on a call, new callers go to hold / team instead of
              interrupting. Text Amber BUSY / AVAILABLE anytime.
            </p>
          ) : null}
          {isBusy && untilLabel ? (
            <p className="mt-1 hidden text-[10px] leading-snug text-muted-foreground md:block">
              Set by Amber text — flips Available at that time (or turn Available on here).
            </p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-full px-2 py-2",
            isBusy && "bg-amber-500/25 ring-2 ring-amber-300"
          )}
        >
          {presenceReady ? (
            isAvailable ? (
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                Active
              </span>
            ) : (
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-200">
                Busy
              </span>
            )
          ) : (
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Available
            </span>
          )}
          <Switch
            id="presence-available-toggle"
            checked={isAvailable}
            disabled={busySaving}
            onCheckedChange={(next) => {
              void setPresenceStatus(next ? "AVAILABLE" : PRESENCE_BUSY_WRITE_STATUS)
            }}
            aria-label="Available — your phone rings first when on"
            className={cn(
              // Bigger than the default switch so you can see it outside.
              "h-7 w-11 border-2",
              isBusy
                ? "data-[state=unchecked]:bg-amber-400 data-[state=unchecked]:border-amber-100 dark:data-[state=unchecked]:bg-amber-400 data-[state=unchecked]:shadow-[0_0_16px_rgba(251,191,36,0.9)]"
                : "data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-200 dark:data-[state=checked]:bg-emerald-500",
              "[&_[data-slot=switch-thumb]]:size-5 [&_[data-slot=switch-thumb]]:bg-white [&_[data-slot=switch-thumb]]:shadow-md dark:[&_[data-slot=switch-thumb]]:bg-white",
              "[&_[data-slot=switch-thumb][data-state=checked]]:translate-x-[1.35rem]"
            )}
          />
        </div>
      </div>
    </section>
  )
}
