"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"

/** Shared chrome for bottom sheets — one narrative across member and operator surfaces. */
export function StorySheetHeader({
  eyebrow,
  storyline,
  step,
  totalSteps,
  title,
  description,
  variant = "member",
}: {
  eyebrow: string
  storyline: string
  step?: number
  totalSteps?: number
  title: string
  description?: ReactNode
  variant?: "member" | "operator"
}) {
  const showSteps = step != null && totalSteps != null && totalSteps > 0
  return (
    <SheetHeader
      className={cn(
        "relative shrink-0 space-y-0 border-b px-4 pb-4 pt-2 text-left",
        variant === "member" && "border-primary/25 bg-gradient-to-br from-primary/[0.18] via-card to-card",
        variant === "operator" && "border-violet-500/35 bg-gradient-to-br from-violet-950/90 via-slate-900 to-slate-950"
      )}
    >
      <div
        className={cn(
          "mx-auto mb-2 h-1.5 w-11 shrink-0 rounded-full",
          variant === "member" ? "bg-foreground/25" : "bg-slate-500/60"
        )}
        aria-hidden
      />
      <p
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.14em]",
          variant === "member" ? "text-primary" : "text-violet-300"
        )}
      >
        {eyebrow}
      </p>
      <p
        className={cn(
          "mt-0.5 text-[11px] leading-snug",
          variant === "member" ? "text-muted-foreground" : "text-slate-400"
        )}
      >
        {storyline}
      </p>
      {showSteps ? (
        <div className="mt-2 flex gap-1" aria-hidden>
          {Array.from({ length: totalSteps! }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-all",
                i < step!
                  ? variant === "member"
                    ? "bg-primary shadow-[0_0_10px_-2px_var(--primary)]"
                    : "bg-violet-400"
                  : variant === "member"
                    ? "bg-muted/70"
                    : "bg-slate-700"
              )}
            />
          ))}
        </div>
      ) : null}
      <SheetTitle
        className={cn(
          "mt-3 text-left text-lg font-semibold tracking-tight",
          variant === "member" ? "text-foreground" : "text-slate-50"
        )}
      >
        {title}
      </SheetTitle>
      {description != null ? (
        <SheetDescription
          className={cn(
            "mt-2 text-left text-xs leading-relaxed",
            variant === "member" ? "text-muted-foreground" : "text-slate-400"
          )}
        >
          {description}
        </SheetDescription>
      ) : null}
    </SheetHeader>
  )
}
