"use client"

// Settings list row — standalone card or inset row inside a grouped list shell.

import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  icon: ReactNode
  title: string
  subtitle?: string
  onClick: () => void
  badge?: string
  destructive?: boolean
  /** Inset row for SettingsGroupedList — no own card border/padding shell. */
  grouped?: boolean
}

export function SettingsMenuRow({
  icon,
  title,
  subtitle,
  onClick,
  badge,
  destructive,
  grouped = false,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 text-left transition-colors",
        grouped
          ? "border-b border-slate-900/60 px-4 py-3 last:border-0 hover:bg-slate-900/40 active:bg-slate-900/60"
          : destructive
            ? "gap-4 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-4 hover:bg-destructive/10 sm:px-5"
            : "gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-4 hover:border-zinc-600 hover:bg-zinc-900/70 sm:px-5"
      )}
    >
      {/* Grouped: bare icon. Standalone: framed icon tile. */}
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          grouped
            ? "h-8 w-8 text-slate-300"
            : cn(
                "h-10 w-10 rounded-xl border border-border/60 bg-card/80",
                destructive && "border-destructive/30 text-destructive"
              )
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-sm font-semibold",
              destructive ? "text-destructive" : "text-foreground"
            )}
          >
            {title}
          </span>
          {badge ? (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
              {badge}
            </span>
          ) : null}
        </span>
        {subtitle ? (
          <span className="mt-0.5 block text-xs leading-snug text-zinc-500">{subtitle}</span>
        ) : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
    </button>
  )
}

/** Native-style grouped list shell for Settings sections. */
export function SettingsGroupedList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-slate-850/60 bg-slate-900/30",
        className
      )}
    >
      {children}
    </div>
  )
}
