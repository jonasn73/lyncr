/** Quiet line-card chrome while numbers load — no pulse bars that flash into real lines. */
export function PhoneLinesSkeleton() {
  return (
    <div
      className="mt-4 flex flex-col gap-2"
      aria-busy="true"
      aria-label="Loading phone lines"
    >
      {[0, 1].map((i) => (
        <div
          key={i}
          className="relative w-full overflow-hidden rounded-xl border border-white/8 bg-neutral-950/30 px-3 py-3"
        >
          <p className="text-[11px] font-medium text-muted-foreground/70">Line</p>
          <p className="mt-1 text-sm font-semibold text-muted-foreground/80">—</p>
        </div>
      ))}
    </div>
  )
}
