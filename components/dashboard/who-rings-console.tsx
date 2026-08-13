"use client"

// Single Lines story: Rings now / If no answer / Your status — replaces Primary + IVR card stack.

import { ChevronRight, PhoneForwarded } from "lucide-react"
import { cn } from "@/lib/utils"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"

export type WhoRingsConsoleProps = {
  ringsNow: string
  ifNoAnswer: string
  statusLabel: "Available" | "Busy" | "…"
  /** Optional one-liner (network pool, etc.) — desktop only when non-actionable. */
  detailHint?: string | null
  onOpenWhoAnswers: () => void
  onOpenGreetings: () => void
  onOpenAbout?: () => void
  loading?: boolean
  className?: string
}

export function WhoRingsConsole({
  ringsNow,
  ifNoAnswer,
  statusLabel,
  detailHint,
  onOpenWhoAnswers,
  onOpenGreetings,
  onOpenAbout,
  loading = false,
  className,
}: WhoRingsConsoleProps) {
  // Hold queue first hop (Busy or Available+on-call) → Press 1 is booking text.
  const fallbackDt =
    ringsNow === "Hold queue" ? "Press 1" : "If no answer"
  const statusTone =
    statusLabel === "Busy"
      ? "text-amber-700 dark:text-amber-400"
      : statusLabel === "Available"
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-muted-foreground"

  return (
    <section
      className={cn(
        "rounded-2xl border border-border/60 bg-muted/15 px-4 py-3.5 sm:px-5 sm:py-4",
        className
      )}
      aria-label="Who rings next"
      aria-busy={loading}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
            <PhoneForwarded className="h-4 w-4 text-primary" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
              Who rings next
            </h2>
            <p className="hidden text-[11px] text-muted-foreground md:block">
              Same rules as live inbound routing
            </p>
          </div>
        </div>
        {onOpenAbout ? (
          <SheetInfoTrigger onPress={onOpenAbout} label="About call flow" className="h-8 w-8 shrink-0" />
        ) : null}
      </div>

      <dl className="space-y-2.5" role="status" aria-live="polite">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Rings now
          </dt>
          <dd className="min-w-0 text-right text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
            {ringsNow}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {fallbackDt}
          </dt>
          <dd className="min-w-0 text-right text-sm font-medium text-foreground [overflow-wrap:anywhere]">
            {ifNoAnswer}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Your status
          </dt>
          <dd className={cn("min-w-0 text-right text-sm font-semibold", statusTone)}>{statusLabel}</dd>
        </div>
      </dl>

      {detailHint?.trim() ? (
        <p className="mt-2.5 hidden text-[11px] leading-snug text-muted-foreground md:block">
          {detailHint.trim()}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-border/50 pt-3">
        <button
          type="button"
          onClick={onOpenWhoAnswers}
          disabled={loading}
          className={cn(
            "inline-flex min-h-10 flex-1 items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-left text-xs font-semibold text-foreground transition-colors hover:bg-muted/40 sm:flex-none",
            MOBILE_TAP_TARGET,
            loading && "pointer-events-none"
          )}
        >
          Who answers
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onOpenGreetings}
          disabled={loading}
          className={cn(
            "inline-flex min-h-10 flex-1 items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-left text-xs font-semibold text-foreground transition-colors hover:bg-muted/40 sm:flex-none",
            MOBILE_TAP_TARGET,
            loading && "pointer-events-none"
          )}
        >
          Greetings
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </div>
    </section>
  )
}
