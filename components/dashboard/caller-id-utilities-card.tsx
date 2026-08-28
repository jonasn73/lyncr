"use client"

// Caller ID card — Spam Shield + CNAM are display-only until Call Control wiring ships.

import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import { cn } from "@/lib/utils"

function ComingSoonRow({
  title,
  description,
  id,
}: {
  title: string
  description: string
  id: string
}) {
  return (
    <div
      id={id}
      className="flex items-center justify-between gap-3 border-b border-slate-900 py-2 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <p className="block text-xs font-semibold text-slate-200">{title}</p>
        <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">{description}</p>
        <p className="mt-1 hidden text-[10px] font-normal leading-snug text-muted-foreground md:block">
          Not wired to live inbound yet — toggle coming later.
        </p>
      </div>
      <span className="shrink-0 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Coming soon
      </span>
    </div>
  )
}

/** Compact Caller ID utilities card for the Lines dashboard (honest / display-only). */
export function CallerIdUtilitiesCard({
  organizationId: _organizationId,
  onOpenTips,
  className,
}: {
  organizationId?: string | null
  onOpenTips: () => void
  className?: string
}) {
  return (
    <section
      id="routing-tips"
      className={cn(
        "rounded-2xl border border-border/60 bg-muted/15 px-4 py-3 sm:px-6 sm:py-4",
        className
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Caller ID</h2>
        <SheetInfoTrigger
          onPress={onOpenTips}
          label="Caller ID"
          className="h-8 w-8 shrink-0"
        />
      </div>

      <div className="mt-1">
        <ComingSoonRow
          id="caller-id-spam-shield"
          title="Spam & Robocall Shield"
          description="Will auto-reject verified high-risk spam before it rings your team"
        />
        <ComingSoonRow
          id="caller-id-enhanced-cnam"
          title="Enhanced CNAM Lookup"
          description="Will show business names on incoming rings when carriers provide them"
        />
      </div>
    </section>
  )
}
