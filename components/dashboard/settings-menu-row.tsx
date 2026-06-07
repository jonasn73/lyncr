"use client"

import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  icon: ReactNode
  title: string
  subtitle: string
  onClick: () => void
  badge?: string
  destructive?: boolean
}

export function SettingsMenuRow({ icon, title, subtitle, onClick, badge, destructive }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-4 rounded-2xl border px-4 py-4 text-left transition-colors sm:px-5",
        destructive
          ? "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
          : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900/70"
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card/80",
          destructive && "border-destructive/30 text-destructive"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn("text-sm font-semibold", destructive ? "text-destructive" : "text-foreground")}>
            {title}
          </span>
          {badge ? (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">{subtitle}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
    </button>
  )
}
