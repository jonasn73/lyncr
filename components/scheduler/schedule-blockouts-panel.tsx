"use client"

// Day list of active blockouts with tap-to-delete.

import { Loader2, Ban } from "lucide-react"
import { cn } from "@/lib/utils"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import { formatBlockoutLabel } from "@/lib/schedule-blockouts"
import type { ScheduleBlockout } from "@/lib/types"

export function ScheduleBlockoutsPanel({
  dateKey,
  blockouts,
  deletingId,
  onDelete,
  onAdd,
}: {
  dateKey: string
  blockouts: ScheduleBlockout[]
  deletingId: string | null
  onDelete: (id: string) => void
  onAdd: () => void
}) {
  const dayRows = blockouts.filter((b) => b.date === dateKey)

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Ban className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
            Blockouts · {dateKey}
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className={cn(
            "shrink-0 rounded-lg bg-amber-600 px-3 text-[11px] font-semibold text-white hover:bg-amber-500",
            MOBILE_TAP_TARGET
          )}
        >
          + Add Blockout Time
        </button>
      </div>

      {dayRows.length === 0 ? (
        <p className="mt-2 text-[11px] text-zinc-500">
          No blockouts on this day — booking and IVR can offer open slots.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {dayRows.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                disabled={deletingId === b.id}
                onClick={() => onDelete(b.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg border border-amber-900/50 bg-zinc-950/60 px-2.5 py-2 text-left transition-colors hover:border-red-500/40 hover:bg-red-950/20",
                  MOBILE_TAP_TARGET
                )}
                title="Tap to delete and reopen slots"
              >
                <span className="min-w-0 truncate text-xs font-medium text-amber-100">
                  {formatBlockoutLabel(b)}
                </span>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-red-300/90">
                  {deletingId === b.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    "Delete"
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
