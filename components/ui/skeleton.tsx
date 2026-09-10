import { cn } from "@/lib/utils"

/**
 * Shared loading placeholder. Every screen was hand-rolling its own `animate-pulse`
 * block with slightly different proportions/timing — this is the one to reach for
 * instead, so first-load states look consistent across the app.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
