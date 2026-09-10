// Route-transition skeleton for the owner dashboard tabs. DashboardShell (the persistent
// sidebar/header) resolves its own session + streamed-bootstrap awaits before this ever
// shows; this covers the per-tab RSC payload fetch/hydration gap instead of freezing the
// previous tab's content — mirrors AdminRouteSkeleton/ReceptionistRouteSkeleton/
// TechRouteSkeleton, which every other portal already had.

import { Skeleton } from "@/components/ui/skeleton"

export function DashboardRouteSkeleton() {
  return (
    <div className="space-y-4 p-3 sm:p-6" aria-hidden="true">
      <Skeleton className="h-6 w-40" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-card/60 p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-5/6" />
        </div>
      ))}
    </div>
  )
}
