/** Pulsing placeholder while phone lines stream in. */
export function PhoneLinesSkeleton() {
  return (
    <div
      className="mt-4 flex flex-col gap-2"
      aria-busy="true"
      aria-label="Loading phone lines"
    >
      <div className="h-[84px] animate-pulse rounded-xl bg-zinc-800/60" />
      <div className="h-[84px] animate-pulse rounded-xl bg-zinc-800/60" />
    </div>
  )
}
