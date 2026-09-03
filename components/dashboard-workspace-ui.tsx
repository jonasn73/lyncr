"use client"

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react"
import { Phone, PhoneMissed, Voicemail } from "lucide-react"
import { cn } from "@/lib/utils"
import { AnimatedStatusLabel } from "@/components/ui/animated-status-label"

import { MOBILE_BLEED } from "@/lib/mobile-shell"

/** Break horizontal scroll strips out of DashboardPageView horizontal padding on phones. */
const WORKSPACE_MOBILE_BLEED = MOBILE_BLEED

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
  /** Press-1 path, but the booking-link SMS itself failed to send — needs attention. */
  | "hold_press1_failed"
  /** Press-1 path, but the send was skipped (caller already had a recent text) — benign. */
  | "hold_press1_skipped"
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
    status === "busy_link" ||
    // Press-1 chose the booking text, but it failed to send — same rescue treatment
    // as a missed call (dial-first callback, "recover this lead" framing).
    status === "hold_press1_failed"
  )
}

/** Hold / press-1 automation — amber accent (not rose Missed). */
export function isHoldActivityStatus(status: ActivityCallStatus): boolean {
  return (
    status === "hold_queue" ||
    status === "hold_press1" ||
    status === "hold_press1_skipped" ||
    status === "busy_menu"
  )
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
    hold_press1_failed:
      "border-destructive/60 bg-destructive/20 text-destructive shadow-[0_0_18px_-3px_rgba(244,63,94,0.65)]",
    hold_press1_skipped:
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
    hold_press1_failed: dense ? "Text failed" : "Press 1 · text failed",
    hold_press1_skipped: dense ? "Already texted" : "Press 1 · already texted",
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
