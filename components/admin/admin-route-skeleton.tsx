// Route-transition skeleton for the admin console tabs. AdminLayout (the persistent
// sidebar/header) resolves its own session await before this ever shows; this covers the
// per-tab RSC payload fetch / hydration gap instead of freezing the previous tab's content.

export function AdminRouteSkeleton() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse space-y-4 p-3 sm:p-6" aria-hidden="true">
      <div className="h-6 w-40 rounded bg-muted" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-card/60 p-4">
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="mt-3 h-3 w-full rounded bg-muted" />
          <div className="mt-2 h-3 w-5/6 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
