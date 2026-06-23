/** Skeleton for the hopper job pool tray while data streams. */
export function JobPoolPanelSkeleton() {
  return (
    <section className="rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-500/5 via-card to-card px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <div className="h-8 w-8 animate-pulse rounded-xl bg-zinc-800/60" />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="h-3.5 w-32 animate-pulse rounded bg-zinc-800/60" />
          <div className="h-3 w-48 animate-pulse rounded bg-zinc-800/40" />
        </div>
      </div>
      <div className="flex gap-2 overflow-hidden pt-1">
        <div className="h-24 w-44 shrink-0 animate-pulse rounded-xl bg-zinc-800/60" />
        <div className="h-24 w-44 shrink-0 animate-pulse rounded-xl bg-zinc-800/60" />
      </div>
    </section>
  )
}

/** Skeleton for the active pipeline left panel while data streams. */
export function ActivePipelinePanelSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading active jobs">
      <div className="h-4 w-28 animate-pulse rounded bg-zinc-800/60" />
      <div className="h-[88px] animate-pulse rounded-xl bg-zinc-800/60" />
      <div className="h-[88px] animate-pulse rounded-xl bg-zinc-800/60" />
    </div>
  )
}

/** Skeleton for scheduler calendar stats while bootstrap streams. */
export function SchedulerCalendarStatsSkeleton() {
  return (
    <p className="mt-2 flex justify-center">
      <span className="h-3 w-36 animate-pulse rounded bg-zinc-800/60" />
    </p>
  )
}
