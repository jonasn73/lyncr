// Shared KPI-tile primitives — was independently redefined as PerfCard (finance-board.tsx)
// and MoneyStripCell (lyncr-admin-dashboard.tsx, since removed as dead code); this is the
// one version every admin page/card should use going forward.

import { cn } from "@/lib/utils"

/** A single labeled number in a grid — tap for the full breakdown when onClick is given. */
export function StatTile({
  label,
  value,
  note,
  onClick,
}: {
  label: string
  value: string
  note?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-xl border border-border bg-card/60 px-3.5 py-3 text-left transition-colors",
        onClick && "hover:border-operator/40 hover:bg-operator/10 cursor-pointer",
        !onClick && "cursor-default"
      )}
    >
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{value}</p>
      {note ? <p className="mt-0.5 text-2xs leading-snug text-muted-foreground">{note}</p> : null}
    </button>
  )
}

/** The one number a page leads with — everything else supports it but isn't what you check first. */
export function HeroStat({
  label,
  value,
  ahead,
  note,
  onClick,
}: {
  label: string
  value: string
  ahead: boolean
  note?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-2xl border px-5 py-4 text-left transition-colors sm:px-6 sm:py-5",
        ahead
          ? "border-success/35 bg-success/10 hover:bg-success/15"
          : "border-warning/35 bg-warning/10 hover:bg-warning/15"
      )}
    >
      <p
        className={cn(
          "text-2xs font-semibold uppercase tracking-wide",
          ahead ? "text-success/80" : "text-warning/80"
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-4xl font-bold tabular-nums sm:text-5xl",
          ahead ? "text-success" : "text-warning"
        )}
      >
        {value}
      </p>
      {note ? <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{note}</p> : null}
    </button>
  )
}
