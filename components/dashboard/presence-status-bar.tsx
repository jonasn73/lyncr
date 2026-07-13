"use client"

// Sticky Presence bar on Lines — Available / On-Job / Closed.

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PresenceStatus } from "@/lib/account-presence"
import { useAccountPresence } from "@/components/dashboard/account-presence-context"

const OPTIONS: {
  value: PresenceStatus
  label: string
  hint: string
}[] = [
  {
    value: "AVAILABLE",
    label: "Available",
    hint: "Ring your cell first",
  },
  {
    value: "ON_JOB",
    label: "On-Job",
    hint: "Busy IVR + booking text",
  },
  {
    value: "CLOSED",
    label: "Closed",
    hint: "No ring — booking link only",
  },
]

export function PresenceStatusBar({ className }: { className?: string }) {
  const { presenceStatus, loading, saving, setPresenceStatus } = useAccountPresence()

  return (
    <div
      className={cn(
        "w-full border-b border-zinc-800/90 bg-slate-950/95 px-3 py-2.5",
        className
      )}
      aria-label="Presence status"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Presence
        </p>
        {loading || saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" aria-hidden />
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {OPTIONS.map((opt) => {
          const active = presenceStatus === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              disabled={loading || saving}
              onClick={() => void setPresenceStatus(opt.value)}
              className={cn(
                "flex min-h-[3.25rem] flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition-colors",
                active
                  ? opt.value === "AVAILABLE"
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                    : opt.value === "ON_JOB"
                      ? "border-amber-500/50 bg-amber-500/15 text-amber-100"
                      : "border-sky-500/50 bg-sky-500/15 text-sky-100"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              )}
            >
              <span className="text-sm font-semibold leading-tight">{opt.label}</span>
              <span className="mt-0.5 hidden text-[9px] leading-tight text-zinc-500 sm:block">
                {opt.hint}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
