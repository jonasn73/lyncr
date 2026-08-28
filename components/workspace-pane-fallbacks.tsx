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
import { cn } from "@/lib/utils"
import { useFlickerDebugLifecycle } from "@/lib/debug/flicker-debug"

/** Activities chrome + table — same as the live tab, no extra padding. */
export function ActivityPaneFallback() {
  useFlickerDebugLifecycle("ActivityPaneFallback", { showingFallback: true })
  return (
    <WorkspacePage aria-busy="true" aria-label="Loading Activity">
      <WorkspacePageHeader eyebrow="Call history" title="Activities" />
      {/* Match live desktop shortcuts so sm+ handoff does not grow a new row. */}
      <div className="hidden flex-wrap items-center gap-3 sm:flex" aria-hidden>
        <span className="inline-flex h-9 min-w-[7.5rem] items-center rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 text-xs font-semibold text-sky-300/50">
          Dispatch Map
        </span>
        <span className="inline-flex h-9 min-w-[7.5rem] items-center rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary/50">
          Job scheduler
        </span>
      </div>
      {/* Match ActivityCallFilterBar height. */}
      <div className="flex flex-wrap gap-2" aria-hidden>
        {["All activity", "Missed today", "Hold", "Press 1"].map((label) => (
          <span
            key={label}
            className="inline-flex h-9 items-center rounded-full border border-border bg-card/60 px-3 text-2xs font-semibold text-muted-foreground"
          >
            {label}
          </span>
        ))}
      </div>
      <ActivityTableSkeleton />
    </WorkspacePage>
  )
}

/** CRM list + profile columns — not an Activity table. */
export function CrmPaneFallback() {
  return (
    <div
      className="mx-auto flex w-full max-w-workspace flex-col gap-3 px-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-3 sm:px-4 md:pb-8"
      aria-busy="true"
      aria-label="Loading CRM"
    >
      <header className="flex flex-col gap-1">
        <p className="hidden text-micro font-semibold uppercase tracking-wider text-muted-foreground md:block">
          CRM
        </p>
        <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-2xl">
          Customers &amp; Leads
        </h1>
      </header>
      <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)] md:items-start md:gap-4">
        <section className="flex flex-col rounded-2xl border border-border/90 bg-background">
          <div className="shrink-0 space-y-2 border-b border-border/80 p-3">
            <div className="h-11 rounded-md border border-border bg-card/80" />
            <div className="flex flex-wrap gap-2">
              {["All", "Leads", "Book forms", "Clients"].map((label) => (
                <span
                  key={label}
                  className="rounded-lg bg-card px-3 py-2 text-2xs font-semibold text-muted-foreground ring-1 ring-border"
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
        <section className="hidden min-h-[20rem] rounded-2xl border border-border/90 bg-background p-4 md:block" />
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
        "sm:h-[calc(100dvh-6.5rem)] sm:min-h-[28rem] sm:rounded-xl sm:border sm:border-border"
      )}
      aria-busy="true"
      aria-label="Loading Map"
    >
      <header className="flex shrink-0 flex-col gap-2 border-b border-border/80 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
              Dispatch Map
            </h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              Jobs, techs, and your location — one map for dispatch.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground">
            Job Pool &amp; Roster
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1" aria-hidden>
          <span className="pr-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            Layers
          </span>
          {["Jobs", "Techs", "Leads", "You"].map((label) => (
            <span
              key={label}
              className="rounded-md border border-border bg-card/60 px-2 py-1 text-2xs text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </div>
      </header>
      <div className="relative min-h-0 flex-1 bg-background">
        {/* Same well as the live map so the chunk swap does not flash a blank hole. */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(39,39,42,0.45),transparent_55%)]" />
        {/* Desktop Job Pool starts open in CSS — keep that width here so the map does not jump. */}
        <div
          className="pointer-events-none absolute bottom-0 right-0 top-0 hidden w-80 max-w-[40%] border-l border-border bg-background/95 md:block"
          aria-hidden
        />
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
        <p className="hidden text-micro font-semibold uppercase tracking-[0.14em] text-primary md:block">
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
    <WorkspacePage className="gap-6 pb-10" aria-busy="true" aria-label="Loading Settings">
      <WorkspacePageHeader eyebrow="Account" title="Settings" />
      <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-card/30 px-4 py-3">
        <span className="h-12 w-12 shrink-0 rounded-full bg-primary/15" />
        <div className="min-w-0 flex-1 space-y-2">
          <span className="block h-4 w-36 rounded bg-muted" />
          <span className="block h-3 w-48 rounded bg-muted/80" />
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

/** Scheduler board chrome — same grid as live so hard refresh is not a blank page + thin bar. */
export function SchedulerPaneFallback() {
  return (
    <WorkspacePage
      className="min-h-[min(70dvh,36rem)]"
      aria-busy="true"
      aria-label="Loading Scheduler"
    >
      <WorkspacePageHeader eyebrow="Dispatch" title="Scheduler" />
      <div className="grid w-full grid-cols-1 items-start gap-3 pb-28 lg:grid-cols-4 lg:gap-4 lg:pb-0">
        {/* Left rail placeholders — intake / pool / live status */}
        <div className="flex w-full min-w-0 flex-col gap-2 lg:col-span-1 lg:gap-3">
          <div className="overflow-hidden rounded-xl border border-border/80 bg-background/40">
            <div className="border-b border-border/80 p-3">
              <div className="h-11 w-full rounded-lg bg-muted/50" />
            </div>
            <div className="space-y-2 border-b border-border/80 px-3 py-3">
              <div className="h-3 w-24 rounded bg-muted/50" />
              <div className="h-16 w-full rounded-lg bg-muted/40" />
              <div className="h-16 w-full rounded-lg bg-muted/40" />
            </div>
            <div className="space-y-2 px-3 py-3">
              <div className="h-3 w-28 rounded bg-muted/50" />
              <div className="h-11 w-full rounded-lg bg-muted/40" />
              <div className="h-11 w-full rounded-lg bg-muted/40" />
            </div>
          </div>
          <div className="h-11 rounded-xl border border-border/80 bg-background/40" />
        </div>
        {/* Main board — pipeline + swimlanes well */}
        <div className="flex w-full min-w-0 flex-col gap-2 lg:col-span-3 lg:gap-3">
          <div className="min-h-[8rem] rounded-xl border border-border/80 bg-background/20 p-3">
            <div className="mb-2 h-4 w-32 rounded bg-muted/50" />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="h-20 rounded-lg bg-muted/40" />
              <div className="h-20 rounded-lg bg-muted/40" />
            </div>
          </div>
          <div className="min-h-[18rem] rounded-xl border border-border/80 bg-background/20 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="h-4 w-36 rounded bg-muted/50" />
              <div className="h-9 w-28 rounded-lg bg-muted/40" />
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="min-h-[14rem] rounded-lg border border-border/60 bg-card/30 p-2">
                  <div className="mb-2 h-3 w-16 rounded bg-muted/50" />
                  <div className="space-y-2">
                    <div className="h-11 w-full rounded bg-muted/40" />
                    <div className="h-11 w-full rounded bg-muted/40" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </WorkspacePage>
  )
}

/** Pay chrome — match live Pay WorkspacePage min height so chunk swap does not collapse. */
export function PayPaneFallback() {
  return (
    <div className="min-h-[32rem] w-full" aria-busy="true" aria-label="Loading Pay">
      <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Billing</p>
      <p className="mt-1 text-lg font-semibold text-foreground">Pay</p>
      <div className="mt-6 grid min-h-[5.75rem] gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card/80 px-4 py-3">
          <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            Lyncr Talk-Time Balance
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">—</p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card/80 px-4 py-3 opacity-60">
          <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            Talk-time used (recent)
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">—</p>
        </div>
      </div>
      <div className="mt-6 min-h-[300px] rounded-2xl border border-border/50 bg-card/30" aria-hidden />
    </div>
  )
}
