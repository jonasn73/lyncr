"use client"

/**
 * Shared sliding filter pills — Activity / CRM / similar tablists.
 * Unique `layoutId` per screen so presence-mounted panes don’t cross-animate.
 */

import { memo, type ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"

export type WorkspaceFilterPillTone = "primary" | "amber" | "sky" | "orange"

export type WorkspaceFilterPill = {
  id: string
  label: string
  badge?: number
  icon?: ReactNode
  /** Active highlight color. Default primary. */
  tone?: WorkspaceFilterPillTone
}

const TONE_ACTIVE: Record<WorkspaceFilterPillTone, string> = {
  primary: "border-primary/40 text-primary",
  amber: "border-amber-500/40 text-amber-100",
  sky: "border-sky-500/40 text-sky-100",
  orange: "border-orange-500/40 text-orange-100",
}

const TONE_PILL: Record<WorkspaceFilterPillTone, string> = {
  primary: "bg-primary/15",
  amber: "bg-amber-500/15",
  sky: "bg-sky-500/20",
  orange: "bg-orange-500/20",
}

const TONE_BADGE_ACTIVE: Record<WorkspaceFilterPillTone, string> = {
  primary: "bg-primary/25 text-primary-foreground",
  amber: "bg-amber-500/25 text-amber-50",
  sky: "bg-sky-500/25 text-sky-50",
  orange: "bg-orange-500/25 text-orange-50",
}

export const WorkspaceFilterPills = memo(function WorkspaceFilterPills({
  items,
  value,
  onChange,
  layoutId,
  className,
  size = "md",
  "aria-label": ariaLabel = "Filters",
}: {
  items: WorkspaceFilterPill[]
  value: string
  onChange: (id: string) => void
  /** Must be unique per mounted screen (Activity vs CRM both stay mounted). */
  layoutId: string
  className?: string
  size?: "sm" | "md"
  "aria-label"?: string
}) {
  const reduceMotion = useReducedMotion()

  return (
    <div
      className={cn(
        // Wrap rather than scroll: the row hid ~110px of filters on phones and ~50px on
        // tablets behind a hidden scrollbar, so options were unreachable with no cue.
        "flex flex-wrap gap-2 pb-1",
        size === "sm" && "gap-2",
        className
      )}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((chip) => {
        const active = value === chip.id
        const tone = chip.tone ?? "primary"
        return (
          <button
            key={chip.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(chip.id)}
            className={cn(
              // Instant text/border — sliding pill carries the motion (no fade flicker).
              "relative inline-flex shrink-0 items-center gap-2 rounded-full border font-semibold touch-manipulation",
              "motion-safe:active:scale-[0.98]",
              size === "sm"
                ? "min-h-8 rounded-lg px-3 py-2 text-[11px]"
                : "min-h-10 px-4 py-2 text-xs",
              active
                ? TONE_ACTIVE[tone]
                : "border-zinc-800 bg-zinc-950/60 text-muted-foreground hover:border-zinc-600 hover:bg-slate-800 hover:text-zinc-100"
            )}
          >
            {active ? (
              reduceMotion ? (
                <span className={cn("absolute inset-0 rounded-[inherit]", TONE_PILL[tone])} aria-hidden />
              ) : (
                <motion.span
                  layoutId={layoutId}
                  className={cn("absolute inset-0 rounded-[inherit]", TONE_PILL[tone])}
                  transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.55 }}
                  aria-hidden
                />
              )
            ) : null}
            <span className="relative z-10 inline-flex items-center gap-2">
              {chip.icon}
              {chip.label}
              {chip.badge != null && chip.badge > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
                    active ? TONE_BADGE_ACTIVE[tone] : "bg-amber-500/15 text-amber-300"
                  )}
                >
                  {chip.badge}
                </span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
})
