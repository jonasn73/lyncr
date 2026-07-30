"use client"

// Sticky Presence bar — Available / Busy only (Smart Busy UI stripped while fixing #185).

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  isBusyPresenceStatus,
  PRESENCE_BUSY_WRITE_STATUS,
  type PresenceStatus,
} from "@/lib/account-presence"
import { useAccountPresence } from "@/components/dashboard/account-presence-context"
import {
  LINES_MOBILE_CARD,
  LINES_MOBILE_PAGE_X,
  LINES_MOBILE_SECTION_LABEL,
} from "@/lib/mobile-shell"

type PresenceUiOption = {
  write: PresenceStatus
  label: string
  hint: string
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
        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
          {loading || saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
          ) : null}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((opt) => {
          const active = presenceReady && opt.isActive(presenceStatus)
          return (
            <button
              key={opt.label}
              type="button"
              disabled={saving}
              onClick={() => void setPresenceStatus(opt.write)}
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
    </div>
  )
}
