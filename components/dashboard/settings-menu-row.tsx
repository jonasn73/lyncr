"use client"

// Settings list row — standalone card or inset row inside a grouped list shell.

import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

type SettingsRowTone = "primary" | "success" | "operator" | "warning"

const TONE_TILE: Record<SettingsRowTone, string> = {
  primary: "border-primary/30 bg-primary/10",
  success: "border-success/30 bg-success/10",
  operator: "border-operator/30 bg-operator/10",
  warning: "border-warning/30 bg-warning/10",
}

type Props = {
  icon: ReactNode
  title: string
  subtitle?: string
  onClick: () => void
  badge?: string
  destructive?: boolean
  /** Inset row for SettingsGroupedList — no own card border/padding shell. */
  grouped?: boolean
  /** Tints the grouped icon tile to match the icon's own color (default: neutral). */
  tone?: SettingsRowTone
}

export function SettingsMenuRow({
  icon,
  title,
  subtitle,
  onClick,
  badge,
  destructive,
  grouped = false,
  tone,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 text-left transition-colors",
        grouped
          ? "border-b border-border/60 px-4 py-3 last:border-0 hover:bg-card/40 active:bg-card/60"
          : destructive
            ? "gap-4 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-4 hover:bg-destructive/10 sm:px-6"
            : "gap-4 rounded-2xl border border-border bg-card/40 px-4 py-4 hover:border-border hover:bg-card/70 sm:px-6"
      )}
    >
      {/* Grouped: small tinted tile matching the icon's own color. Standalone: larger framed tile. */}
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          grouped
            ? cn("h-9 w-9 rounded-lg border", tone ? TONE_TILE[tone] : "border-border/60 bg-card/60")
            : cn(
                "h-11 w-11 rounded-xl border border-border/60 bg-card/80",
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
            <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-warning">
              {badge}
            </span>
          ) : null}
        </span>
        {subtitle ? (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
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
        "overflow-hidden rounded-xl border border-border/60 bg-card/30",
        className
      )}
    >
      {children}
    </div>
  )
}
