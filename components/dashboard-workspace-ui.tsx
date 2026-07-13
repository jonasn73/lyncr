"use client"

import { type HTMLAttributes, type ReactNode } from "react"
import { cn } from "@/lib/utils"
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
    <div className={cn("mx-auto flex w-full max-w-7xl flex-col gap-6 sm:gap-8", className)} {...rest}>
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
        ) : null}
        <h1 className={cn("text-2xl font-semibold tracking-tight text-foreground sm:text-3xl", eyebrow && "mt-1")}>
          {title}
        </h1>
      </div>
      {action ? <div className="w-full min-w-0 sm:w-auto sm:shrink-0">{action}</div> : null}
    </div>
  )
}

export function WorkspacePanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-border/60 bg-card/90 shadow-lg ring-1 ring-border/40",
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
}: {
  label: string
  value: string
  hint?: string
  accent?: "primary" | "success" | "warning"
}) {
  const accentClass =
    accent === "success"
      ? "border-success/30 bg-success/5"
      : accent === "warning"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-primary/30 bg-primary/5"
  return (
    <div className={cn("min-h-[5.75rem] rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5", accent && accentClass)}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
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
    <div className="min-h-[5.75rem] rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {used.toLocaleString()} / {included.toLocaleString()} mins used
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-500/80 via-primary to-primary shadow-[var(--electric-glow)] transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={included}
        />
      </div>
      {hint ? <p className="mt-2 text-xs text-zinc-500">{hint}</p> : null}
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
    <div className="min-h-[5.75rem] rounded-2xl border border-success/30 bg-success/5 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {tokens.toLocaleString()}
        <span className="ml-1.5 text-base font-medium text-zinc-400">tokens</span>
      </p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  )
}

export type StatusTone = "success" | "primary" | "destructive" | "warning" | "muted"

export function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  const toneClass: Record<StatusTone, string> = {
    success: "border-success/40 bg-success/15 text-success",
    primary: "border-primary/40 bg-primary/15 text-primary",
    destructive: "border-destructive/40 bg-destructive/15 text-destructive",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    muted: "border-zinc-700 bg-zinc-900/80 text-zinc-400",
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        toneClass[tone]
      )}
    >
      {label}
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
      "border-amber-500/50 bg-amber-500/10 text-amber-300 shadow-[0_0_14px_-4px_rgba(245,158,11,0.55)]",
    blue: "border-sky-500/45 bg-sky-500/10 text-sky-300 shadow-[0_0_14px_-4px_rgba(56,189,248,0.45)]",
    muted: "border-zinc-600/80 bg-zinc-900/60 text-zinc-400",
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wide",
        styles[variant]
      )}
    >
      {label}
    </span>
  )
}

export type ActivityCallStatus = "answered" | "ai_handled" | "missed" | "missed_ivr" | "voicemail"

export function ActivityStatusPill({ status }: { status: ActivityCallStatus }) {
  const styles: Record<ActivityCallStatus, string> = {
    answered:
      "border-emerald-500/45 bg-emerald-500/12 text-emerald-300 shadow-[0_0_14px_-6px_rgba(16,185,129,0.55)]",
    ai_handled:
      "border-violet-500/45 bg-violet-500/12 text-violet-300 shadow-[0_0_14px_-6px_rgba(139,92,246,0.45)]",
    voicemail:
      "border-amber-500/40 bg-amber-500/10 text-amber-300 shadow-[0_0_14px_-6px_rgba(245,158,11,0.35)]",
    missed_ivr:
      "border-amber-500/45 bg-amber-500/12 text-amber-200 shadow-[0_0_14px_-6px_rgba(245,158,11,0.4)]",
    missed: "border-red-500/35 bg-red-500/8 text-red-400",
  }
  const labels: Record<ActivityCallStatus, string> = {
    answered: "Answered",
    ai_handled: "AI handled",
    voicemail: "Voicemail",
    missed_ivr: "Missed (IVR)",
    missed: "Missed",
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        styles[status]
      )}
    >
      {labels[status]}
    </span>
  )
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
        "flex w-full items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-left transition-colors",
        destructive
          ? "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
          : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900/70"
      )}
    >
      <span className="flex items-center gap-3">
        <span className={cn("text-muted-foreground", destructive && "text-destructive")}>{icon}</span>
        <span className={cn("text-sm font-medium", destructive ? "text-destructive" : "text-foreground")}>{label}</span>
      </span>
      <span className="text-zinc-600">›</span>
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
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3.5 transition-colors hover:border-zinc-700">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-zinc-600 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
    </label>
  )
}

export const workspaceFieldClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground transition-colors duration-200 placeholder:text-zinc-600 hover:border-zinc-600 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"

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
  const inner = (
    <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <table
        className={cn(
          "w-full min-w-[640px] table-fixed border-collapse text-left text-sm",
          className
        )}
      >
        {children}
      </table>
    </div>
  )
  if (bleed) {
    return <div className={WORKSPACE_MOBILE_BLEED}>{inner}</div>
  }
  return inner
}

export function WorkspaceTh({ children }: { children: ReactNode }) {
  return (
    <th className="border-b border-zinc-800/80 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
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
    <td colSpan={colSpan} className={cn("border-b border-zinc-800/50 px-4 py-3.5 text-foreground", className)}>
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
    <section className="border-b border-zinc-800/80 px-5 py-6 last:border-b-0">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-relaxed text-zinc-500">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}
