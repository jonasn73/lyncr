// Route-transition skeleton for the receptionist portal tabs. ReceptionistPortalLayout
// (the persistent chrome/sidebar) already resolves its own session + context awaits before
// this ever shows; several tabs (customers, dispatch, scheduler, training) do their own
// `await requireReceptionistCapability(...)` in page.tsx, which is what this covers instead
// of freezing the previous tab's content during the transition.

export function ReceptionistRouteSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="h-6 w-40 rounded bg-muted" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="mt-3 h-3 w-full rounded bg-muted" />
          <div className="mt-2 h-3 w-5/6 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
