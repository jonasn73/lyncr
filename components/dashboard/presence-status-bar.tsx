"use client"

// Compact Available toggle — sits under Alerts with Caller ID on Lines.
// On = Available (cell rings first). Off = Busy (skip phone → booking text).
// Uses plain-button Switch (not Radix) to avoid React #185.

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import {
  isBusyPresenceStatus,
  PRESENCE_BUSY_WRITE_STATUS,
} from "@/lib/account-presence"
import { useAccountPresence } from "@/components/dashboard/account-presence-context"

export function PresenceStatusBar({ className }: { className?: string }) {
  const { presenceStatus, presenceReady, loading, saving, setPresenceStatus } = useAccountPresence()

  // Available = switch on; Busy (ON_JOB / CLOSED) = switch off.
  const isAvailable = presenceReady && presenceStatus === "AVAILABLE"
  const isBusy = presenceReady && isBusyPresenceStatus(presenceStatus)
  const busySaving = saving || loading

  return (
    <section
      className={cn(
        "rounded-2xl border border-border/60 bg-muted/15 px-4 py-3 sm:px-6 sm:py-4",
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
                <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
              ) : null}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-normal text-slate-500">
            {isBusy
              ? "Skip your phone → Available team, then hold queue"
              : "Your phone rings first"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {presenceReady ? (
            isAvailable ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                Active
              </span>
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                Busy
              </span>
            )
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              …
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
          />
        </div>
      </div>
    </section>
  )
}
