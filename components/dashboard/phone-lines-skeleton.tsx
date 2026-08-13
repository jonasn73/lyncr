/** Placeholder line cards — same rounded border/height as live PhoneLinesList. */
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
          <div className="h-2.5 w-20 rounded bg-muted/40" />
          <div className="mt-1.5 h-4 w-36 rounded bg-muted/50" />
        </div>
      ))}
    </div>
  )
}
