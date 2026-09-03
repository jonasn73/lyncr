// Shared route-transition skeleton for the tech console tabs. Each tab's page.tsx does its
// own `await getSessionUser()` / `await getFieldTechContext()` before rendering — this is what
// Next shows via loading.tsx while that resolves, instead of freezing the previous tab's content
// (and instead of the final layout popping in from nothing once the awaits settle).

export function TechRouteSkeleton() {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col" aria-hidden="true">
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </div>
      <main className="flex-1 space-y-3 px-4 py-6">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-2xl border border-border bg-card p-4 shadow-raised"
          >
            <div className="h-4 w-2/3 rounded bg-muted" />
            <div className="mt-2 h-3 w-1/2 rounded bg-muted" />
            <div className="mt-4 h-3 w-full rounded bg-muted" />
            <div className="mt-2 h-3 w-5/6 rounded bg-muted" />
          </div>
        ))}
      </main>
    </div>
  )
}
