"use client"

// Layout-matched loading shells so reload paints the real page shape, not a tiny dark box.

import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
  MOBILE_PANEL_VIEWPORT_MIN_H,
} from "@/components/dashboard-workspace-ui"
import {
  ActivityTableSkeleton,
  CrmListRowSkeleton,
  MessagesThreadListSkeleton,
} from "@/components/workspace-content-skeletons"
import { SchedulerCalendarStatsSkeleton } from "@/components/scheduler/scheduler-panel-skeletons"
import { cn } from "@/lib/utils"

/** Activities chrome + table — same as the live tab, no extra padding. */
export function ActivityPaneFallback() {
  return (
    <WorkspacePage aria-busy="true" aria-label="Loading Activity">
      <WorkspacePageHeader eyebrow="Call history" title="Activities" />
      <ActivityTableSkeleton />
    </WorkspacePage>
  )
}

/** CRM list + profile columns — not an Activity table. */
export function CrmPaneFallback() {
  return (
    <div
      className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-3 sm:px-4 md:pb-8"
      aria-busy="true"
      aria-label="Loading CRM"
    >
      <header className="flex flex-col gap-1">
        <p className="hidden text-[10px] font-semibold uppercase tracking-wider text-zinc-500 md:block">
          CRM
        </p>
        <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-2xl">
          Customers &amp; Leads
        </h1>
      </header>
      <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)] md:items-start md:gap-4">
        <section className="flex flex-col rounded-2xl border border-zinc-800/90 bg-background">
          <div className="shrink-0 space-y-2 border-b border-zinc-800/80 p-3">
            <div className="h-10 rounded-md border border-zinc-800 bg-zinc-900/80" />
            <div className="flex flex-wrap gap-1.5">
              {["All", "Leads", "Book forms", "Clients"].map((label) => (
                <span
                  key={label}
                  className="rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-500 ring-1 ring-zinc-800"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="p-2">
            <CrmListRowSkeleton count={6} />
          </div>
        </section>
        <section className="hidden min-h-[20rem] rounded-2xl border border-zinc-800/90 bg-background p-4 md:block" />
      </div>
    </div>
  )
}

/** Dispatch Map chrome — same height/header as MapTab, empty map well. */
export function MapPaneFallback() {
  return (
    <div
      className={cn(
        "relative flex w-full flex-col overflow-hidden bg-background",
        "h-[calc(100dvh-8.75rem)] min-h-[22rem]",
        "sm:h-[calc(100dvh-6.5rem)] sm:min-h-[28rem] sm:rounded-xl sm:border sm:border-zinc-800"
      )}
      aria-busy="true"
      aria-label="Loading Map"
    >
      <header className="flex shrink-0 flex-col gap-2 border-b border-zinc-800/80 px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg">
              Dispatch Map
            </h1>
            <p className="hidden truncate text-xs text-slate-500 sm:block">
              Jobs, techs, and your location — one map for dispatch.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-slate-200">
            Job Pool &amp; Roster
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1" aria-hidden>
          <span className="pr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Layers
          </span>
          {["Jobs", "Techs", "Leads", "You"].map((label) => (
            <span
              key={label}
              className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[11px] text-slate-400"
            >
              {label}
            </span>
          ))}
        </div>
      </header>
      <div className="relative min-h-0 flex-1 bg-background">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(39,39,42,0.45),transparent_55%)]" />
      </div>
    </div>
  )
}

/** Messages inbox chrome + conversation list rows. */
export function MessagesPaneFallback() {
  return (
    <WorkspacePage
      className="gap-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:gap-6 md:pb-8"
      aria-busy="true"
      aria-label="Loading Messages"
    >
      <div className="min-w-0">
        <p className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-primary md:block">
          SMS
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl md:mt-1 md:text-3xl">
          Messages
        </h1>
      </div>
      <WorkspacePanel
        className={cn(
          "overflow-hidden md:grid md:grid-cols-[minmax(240px,320px)_1fr]",
          MOBILE_PANEL_VIEWPORT_MIN_H
        )}
      >
        <div className="flex min-h-[50vh] flex-col border-border/60 md:min-h-0 md:border-r">
          <div className="border-b border-border/60 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Conversations
            </p>
          </div>
          <div className="p-2">
            <MessagesThreadListSkeleton count={6} />
          </div>
        </div>
        <div className="hidden md:block" />
      </WorkspacePanel>
    </WorkspacePage>
  )
}

/** Settings list chrome — no small dark card. */
export function SettingsPaneFallback() {
  return (
    <WorkspacePage className="gap-5 pb-10" aria-busy="true" aria-label="Loading Settings">
      <WorkspacePageHeader eyebrow="Account" title="Settings" />
      <div className="flex items-center gap-4 rounded-xl border border-slate-850/60 bg-slate-900/30 px-4 py-3">
        <span className="h-12 w-12 shrink-0 rounded-full bg-primary/15" />
        <div className="min-w-0 flex-1 space-y-2">
          <span className="block h-4 w-36 rounded bg-zinc-800" />
          <span className="block h-3 w-48 rounded bg-zinc-800/80" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-14 rounded-xl border border-border/50 bg-card/30" />
        ))}
      </div>
    </WorkspacePage>
  )
}

/** Scheduler chrome + calendar stats only (not call-flow cards). */
export function SchedulerPaneFallback() {
  return (
    <WorkspacePage aria-busy="true" aria-label="Loading Scheduler">
      <WorkspacePageHeader eyebrow="Dispatch" title="Scheduler" />
      <SchedulerCalendarStatsSkeleton />
    </WorkspacePage>
  )
}

/** Pay chrome — PageView already pads; do not add extra inset. */
export function PayPaneFallback() {
  return (
    <div className="min-h-[40vh] w-full" aria-busy="true" aria-label="Loading Pay">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Billing</p>
      <p className="mt-1 text-lg font-semibold text-foreground">Pay</p>
      <div className="mt-6 grid min-h-[5.75rem] gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card/80 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Lyncr Talk-Time Balance
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">—</p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card/80 px-4 py-3 opacity-60">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Talk-time used (recent)
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">—</p>
        </div>
      </div>
    </div>
  )
}
