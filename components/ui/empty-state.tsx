import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Shared "nothing here yet" treatment — icon badge + message + optional hint/action.
 * Modeled on the one screen that already had this right (Team's roster empty state);
 * everywhere else was falling back to a bare line of text. Reach for this instead.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-14 text-center", className)}>
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/60 text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm text-muted-foreground">{title}</p>
      {description ? (
        <p className="max-w-[18rem] text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
