"use client"

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react"
import { Phone, PhoneMissed, Voicemail } from "lucide-react"
import { cn } from "@/lib/utils"
import { AnimatedStatusLabel } from "@/components/ui/animated-status-label"
export { WORKSPACE_SHEET_CLASS } from "@/lib/workspace-sheet-classes"

import { MOBILE_BLEED } from "@/lib/mobile-shell"

/** Break horizontal scroll strips out of DashboardPageView horizontal padding on phones. */
export const WORKSPACE_MOBILE_BLEED = MOBILE_BLEED

/** Min height for full-bleed panels below the sticky header + mobile bottom command dock. */
export const MOBILE_PANEL_VIEWPORT_MIN_H =
  "min-h-[calc(100dvh-15rem-env(safe-area-inset-bottom,0px)-4rem)] md:min-h-[calc(100dvh-15rem)]"

export function WorkspacePage({
  children,
  className,
  ...rest
}: {
  children: ReactNode
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mx-auto flex w-full max-w-workspace flex-col gap-6 sm:gap-8", className)} {...rest}>
      {children}
    </div>
  )
}

export function WorkspacePageHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string
  title: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="min-h-[1rem] text-micro font-semibold uppercase tracking-[0.14em] text-primary">
            {eyebrow}
          </p>
        ) : null}
        <h1
          className={cn(
            "text-2xl font-semibold tracking-tight text-foreground sm:text-3xl",
            eyebrow && "mt-1"
          )}
        >
          {title}
        </h1>
      </div>
      {action ? <div className="w-full min-w-0 sm:w-auto sm:shrink-0">{action}</div> : null}
    </div>
  )
}

/**
 * The three panel paddings. Call sites pick a density instead of spelling out
 * `p-*`, so panel padding stays on the 16 / 24 / 32 scale everywhere.
 */
const WORKSPACE_PANEL_DENSITY = {
  compact: "p-4",
  default: "p-4 sm:p-6",
  roomy: "p-6 sm:p-8",
} as const

export type WorkspacePanelDensity = keyof typeof WORKSPACE_PANEL_DENSITY

export function WorkspacePanel({
  children,
  className,
  density,
}: {
  children: ReactNode
  className?: string
  /** Panel padding. Omit for panels that pad their own body (scroll panes, tables, split layouts). */
  density?: WorkspacePanelDensity
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-border/60 bg-card/90 shadow-raised ring-1 ring-border/40",
        density && WORKSPACE_PANEL_DENSITY[density],
        className
      )}
    >
      {children}
    </section>
  )
}

/** Fixed table row height — prevents row reflow when data mounts. */
export const WORKSPACE_TABLE_ROW_CLASS = "h-[52px] [&>td]:h-[52px] [&>td]:align-middle"

/** Call-flow step grid minimum footprint. */
export const CALL_FLOW_STEPS_MIN_H = "min-h-[14.5rem]"

export function WorkspaceStatCard({
  label,
  value,
  hint,
  accent,
  dense = false,
}: {
  label: string
  value: string
  hint?: string
  accent?: "primary" | "success" | "warning"
  /** Compact tile for tight ops screens (e.g. receptionist Home) — smaller padding/radius,
   *  hint hidden on phones. Same metric-tile pattern as the default size, just denser. */
  dense?: boolean
}) {
  const accentClass =
    accent === "success"
      ? "border-success/30 bg-success/5"
      : accent === "warning"
        ? "border-warning/30 bg-warning/5"
        : "border-primary/30 bg-primary/5"
  if (dense) {
    return (
      <div className={cn("rounded-xl border border-border/50 bg-card/70 px-3 py-3 sm:px-4", accent && accentClass)}>
        <p className="text-micro font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-foreground sm:text-2xl">
          {value}
        </p>
        {hint ? <p className="mt-0.5 hidden text-2xs text-muted-foreground sm:block">{hint}</p> : null}
      </div>
    )
  }
  return (
    // eslint-disable-next-line no-restricted-syntax -- p-5 holds min-h-[5.75rem], a reserved height shared with the skeletons
    <div className={cn("min-h-[5.75rem] rounded-2xl border border-border bg-card/50 p-5", accent && accentClass)}>
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function WorkspaceUsageStatCard({
  label,
  used,
  included,
  hint,
}: {
  label: string
  used: number
  included: number
  hint?: string
}) {
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0
  return (
    // eslint-disable-next-line no-restricted-syntax -- p-5 holds min-h-[5.75rem], a reserved height shared with the skeletons
    <div className="min-h-[5.75rem] rounded-2xl border border-warning/30 bg-warning/5 p-5">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {used.toLocaleString()} / {included.toLocaleString()} mins used
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-warning/80 via-primary to-primary shadow-[var(--electric-glow)] transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={included}
        />
      </div>
      {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function WorkspaceTokenStatCard({
  label,
  tokens,
  hint,
}: {
  label: string
  tokens: number
  hint?: string
}) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- p-5 holds min-h-[5.75rem], a reserved height shared with the skeletons
    <div className="min-h-[5.75rem] rounded-2xl border border-success/30 bg-success/5 p-5">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {tokens.toLocaleString()}
        <span className="ml-1.5 text-base font-medium text-muted-foreground">tokens</span>
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export type StatusTone = "success" | "primary" | "destructive" | "warning" | "muted"

export function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  const toneClass: Record<StatusTone, string> = {
    success: "border-success/40 bg-success/15 text-success",
    primary: "border-primary/40 bg-primary/15 text-primary",
    destructive: "border-destructive/40 bg-destructive/15 text-destructive",
    warning: "border-warning/40 bg-warning/10 text-warning",
    muted: "border-border bg-card/80 text-muted-foreground",
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-0.5 text-micro font-bold uppercase tracking-wide",
        toneClass[tone]
      )}
    >
      <AnimatedStatusLabel value={label} />
    </span>
  )
}

export function IntentPill({ label }: { label: string }) {
  return <LeadIntentPill label={label} variant="blue" />
}

export type LeadIntentVariant = "amber" | "blue" | "muted"

export function LeadIntentPill({ label, variant }: { label: string; variant: LeadIntentVariant }) {
  const styles: Record<LeadIntentVariant, string> = {
    amber:
      "border-warning/50 bg-warning/10 text-warning shadow-[0_0_14px_-4px_rgba(245,158,11,0.55)]",
    blue: "border-info/45 bg-info/10 text-info shadow-[0_0_14px_-4px_rgba(56,189,248,0.45)]",
    muted: "border-border/80 bg-card/60 text-muted-foreground",
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-2xs font-semibold tracking-wide",
        styles[variant]
      )}
    >
      {label}
    </span>
  )
}

export type ActivityCallStatus =
  | "answered"
  | "answered_from_queue"
  | "ai_handled"
  | "missed"
  | "missed_ivr"
  | "voicemail"
  | "night_link"
  | "day_link"
  | "day_off_link"
  | "busy_link"
  | "hold_queue"
  | "hold_press1"
  | "busy_menu"
  | "emergency"

/** Unanswered / rescue family — used for card accents vs answered green. */
export function isMissedActivityStatus(status: ActivityCallStatus): boolean {
  return (
    status === "missed" ||
    status === "missed_ivr" ||
    status === "voicemail" ||
    status === "night_link" ||
    status === "day_link" ||
    status === "day_off_link" ||
    status === "busy_link"
  )
}

/** Hold / press-1 automation — amber accent (not rose Missed). */
export function isHoldActivityStatus(status: ActivityCallStatus): boolean {
  return status === "hold_queue" || status === "hold_press1" || status === "busy_menu"
}

export function ActivityStatusPill({
  status,
  /** Dense list rows: shorter label, no glow so more numbers fit. */
  dense = false,
}: {
  status: ActivityCallStatus
  dense?: boolean
}) {
  const styles: Record<ActivityCallStatus, string> = {
    answered:
      "border-success/55 bg-success/18 text-success shadow-[0_0_16px_-4px_rgba(16,185,129,0.65)]",
    answered_from_queue:
      "border-success/55 bg-success/18 text-success shadow-[0_0_16px_-4px_rgba(16,185,129,0.65)]",
    emergency:
      "border-success/55 bg-success/18 text-success shadow-[0_0_16px_-4px_rgba(16,185,129,0.65)]",
    ai_handled:
      "border-operator/45 bg-operator/12 text-operator shadow-[0_0_14px_-6px_rgba(139,92,246,0.45)]",
    voicemail:
      "border-destructive/50 bg-destructive/15 text-destructive shadow-[0_0_16px_-4px_rgba(244,63,94,0.45)]",
    missed_ivr:
      "border-destructive/55 bg-destructive/18 text-destructive shadow-[0_0_16px_-4px_rgba(244,63,94,0.55)]",
    night_link:
      "border-destructive/50 bg-destructive/15 text-destructive shadow-[0_0_16px_-4px_rgba(244,63,94,0.45)]",
    day_link:
      "border-destructive/50 bg-destructive/15 text-destructive shadow-[0_0_16px_-4px_rgba(244,63,94,0.45)]",
    day_off_link:
      "border-destructive/50 bg-destructive/15 text-destructive shadow-[0_0_16px_-4px_rgba(244,63,94,0.45)]",
    busy_link:
      "border-destructive/50 bg-destructive/15 text-destructive shadow-[0_0_16px_-4px_rgba(244,63,94,0.45)]",
    hold_queue:
      "border-warning/50 bg-warning/15 text-warning shadow-[0_0_14px_-6px_rgba(245,158,11,0.45)]",
    hold_press1:
      "border-warning/50 bg-warning/15 text-warning shadow-[0_0_14px_-6px_rgba(245,158,11,0.45)]",
    busy_menu:
      "border-warning/45 bg-warning/12 text-warning shadow-[0_0_12px_-6px_rgba(245,158,11,0.4)]",
    missed:
      "border-destructive/60 bg-destructive/20 text-destructive shadow-[0_0_18px_-3px_rgba(244,63,94,0.65)]",
  }
  const labels: Record<ActivityCallStatus, string> = {
    answered: "Answered",
    answered_from_queue: dense ? "From queue" : "Answered from queue",
    emergency: dense ? "Emergency" : "Emergency answered",
    ai_handled: dense ? "AI" : "AI handled",
    voicemail: "Voicemail",
    missed_ivr: dense ? "Missed" : "Missed · IVR",
    night_link: dense ? "Missed" : "Missed · night link",
    day_link: dense ? "Missed" : "Missed · day link",
    day_off_link: dense ? "Missed" : "Missed · day-off link",
    busy_link: dense ? "Missed" : "Missed · busy link",
    hold_queue: dense ? "On hold" : "Hold queue",
    hold_press1: dense ? "Press 1" : "Press 1 · booking text",
    busy_menu: dense ? "Busy" : "Busy · hold menu",
    missed: "Missed",
  }
  const Icon =
    status === "answered" || status === "answered_from_queue" || status === "emergency"
      ? Phone
      : status === "voicemail"
        ? Voicemail
        : status === "ai_handled" || isHoldActivityStatus(status)
          ? Phone
          : PhoneMissed

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border font-bold uppercase tracking-wide",
        dense
          ? "px-2 py-0.5 text-2xs shadow-none"
          : "px-2 py-0.5 text-2xs",
        styles[status],
        dense && "shadow-none"
      )}
      title={labels[status] === "Missed" && status !== "missed" ? status.replace(/_/g, " ") : undefined}
    >
      <Icon className={cn("shrink-0 opacity-90", dense ? "h-2.5 w-2.5" : "h-3 w-3")} aria-hidden />
      <AnimatedStatusLabel value={labels[status]} />
    </span>
  )
}

/** Soft card chrome so missed rows never look like answered emerald cards. */
export function activityRowAccentClass(status: ActivityCallStatus): string {
  // Left border only — full-row tint stacked across Hold/Press 1 looked like a brown overlay.
  if (status === "answered" || status === "answered_from_queue" || status === "emergency") {
    return "border-l-[3px] border-l-emerald-500/70 bg-transparent"
  }
  if (status === "ai_handled") {
    return "border-l-[3px] border-l-violet-500/60 bg-transparent"
  }
  if (isHoldActivityStatus(status)) {
    return "border-l-[3px] border-l-amber-500/70 bg-transparent"
  }
  if (isMissedActivityStatus(status)) {
    return "border-l-[3px] border-l-rose-500 bg-transparent"
  }
  return "border-l-[3px] border-l-transparent bg-transparent"
}

export function WorkspaceDisclosureRow({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-2xl border px-6 py-4 text-left transition-colors",
        destructive
          ? "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
          : "border-border bg-card/40 hover:border-border hover:bg-card/70"
      )}
    >
      <span className="flex items-center gap-3">
        <span className={cn("text-muted-foreground", destructive && "text-destructive")}>{icon}</span>
        <span className={cn("text-sm font-medium", destructive ? "text-destructive" : "text-foreground")}>{label}</span>
      </span>
      <span className="text-muted-foreground">›</span>
    </button>
  )
}

export function WorkspaceToggleCard({
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-background/50 px-4 py-4 transition-colors hover:border-border">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-border accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
    </label>
  )
}

export const workspaceFieldClass =
  "w-full rounded-lg border border-border bg-card/50 px-3 py-3 text-sm text-foreground transition-colors duration-200 placeholder:text-muted-foreground hover:border-border focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"

/**
 * Tracks whether a horizontal scroller has more content off either edge.
 * Starts false so the server render and first client render agree (no hydration mismatch);
 * the effect fills in the real values right after mount.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [edges, setEdges] = useState({ start: false, end: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      setEdges({ start: el.scrollLeft > 1, end: max > 1 && el.scrollLeft < max - 1 })
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", update)
      ro.disconnect()
    }
  }, [])
  return { ref, ...edges }
}

/** Edge fade marking content that continues past a scroller — the scrollbar is hidden. */
export function ScrollEdgeFade({ side, show }: { side: "left" | "right"; show: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0 z-10 w-10 transition-opacity duration-150",
        side === "right"
          ? "right-0 bg-gradient-to-l from-background to-transparent"
          : "left-0 bg-gradient-to-r from-background to-transparent",
        show ? "opacity-100" : "opacity-0"
      )}
    />
  )
}

export function WorkspaceTableWrap({
  children,
  className,
  bleed = false,
}: {
  children: ReactNode
  className?: string
  /** Extend scroll area to screen edges on mobile (inside DashboardPageView padding). */
  bleed?: boolean
}) {
  // The table has a 640px floor, so on phones it always scrolls — with the scrollbar
  // hidden there was no cue that columns continued off-screen.
  const { ref, start, end } = useScrollEdges<HTMLDivElement>()
  const inner = (
    <div className="relative">
      <div
        ref={ref}
        className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <table
          className={cn(
            "w-full min-w-[640px] table-fixed border-collapse text-left text-sm",
            className
          )}
        >
          {children}
        </table>
      </div>
      <ScrollEdgeFade side="left" show={start} />
      <ScrollEdgeFade side="right" show={end} />
    </div>
  )
  if (bleed) {
    return <div className={WORKSPACE_MOBILE_BLEED}>{inner}</div>
  }
  return inner
}

export function WorkspaceTh({
  children,
  className,
}: {
  children: ReactNode
  /** Callers pass alignment here (e.g. text-right). Previously dropped on the floor. */
  className?: string
}) {
  return (
    <th
      className={cn(
        "border-b border-border/80 px-4 py-3 text-micro font-semibold uppercase tracking-wider text-muted-foreground",
        className
      )}
    >
      {children}
    </th>
  )
}

export function WorkspaceTd({
  children,
  className,
  colSpan,
}: {
  children: ReactNode
  className?: string
  colSpan?: number
}) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-border/50 px-4 py-4 text-foreground", className)}>
      {children}
    </td>
  )
}

export function WorkspaceModule({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="border-b border-border/80 px-6 py-6 last:border-b-0">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}
