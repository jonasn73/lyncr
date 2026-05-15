"use client"

import { memo, useMemo } from "react"
import { Info } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { getAppSheetStory } from "@/components/app-sheet-stories"
import { cn } from "@/lib/utils"

/** Compact story layer above sheets/modals (z-[200]) so it stacks above Sheet z-[110]. */
export const StoryPopoverInfo = memo(function StoryPopoverInfo({
  storyKey,
  label = "Learn more",
  className,
  triggerClassName,
  variant = "member",
}: {
  storyKey: string
  label?: string
  className?: string
  triggerClassName?: string
  variant?: "member" | "operator"
}) {
  const story = useMemo(() => getAppSheetStory(storyKey), [storyKey])
  if (!story) return null
  const op = variant === "operator"
  return (
    <Popover modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
            op
              ? "text-slate-400 hover:bg-violet-500/15 hover:text-violet-200"
              : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
            triggerClassName
          )}
          aria-label={label}
        >
          <Info className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        motion="fade"
        align="end"
        sideOffset={6}
        className={cn(
          "z-[200] w-[min(92vw,22rem)] max-h-[min(58vh,400px)] overflow-y-auto overscroll-contain p-0 shadow-xl",
          op ? "border-slate-600 bg-slate-950 text-slate-200" : "border-border/80 bg-popover text-popover-foreground",
          className
        )}
      >
        <div
          className={cn(
            "border-b px-3 py-2.5",
            op
              ? "border-violet-500/35 bg-gradient-to-br from-violet-950/90 via-slate-900 to-slate-950"
              : "border-primary/20 bg-gradient-to-br from-primary/[0.12] via-card to-card"
          )}
        >
          <p
            className={cn(
              "text-[10px] font-semibold uppercase tracking-[0.12em]",
              op ? "text-violet-300" : "text-primary"
            )}
          >
            {story.eyebrow}
          </p>
          <p className={cn("mt-0.5 text-[10px] leading-snug", op ? "text-slate-400" : "text-muted-foreground")}>
            {story.storyline}
          </p>
          <p className={cn("mt-2 text-sm font-semibold leading-tight", op ? "text-slate-50" : "text-foreground")}>
            {story.title}
          </p>
        </div>
        <div
          className={cn(
            "space-y-2 px-3 py-2.5 text-xs leading-relaxed [&_p]:mt-2 [&_p:first-child]:mt-0 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5",
            op
              ? "text-slate-400 [&_p]:text-slate-400 [&_strong]:text-slate-200 [&_code]:bg-slate-900 [&_code]:text-violet-200"
              : "text-muted-foreground [&_code]:bg-muted"
          )}
        >
          {story.description}
        </div>
      </PopoverContent>
    </Popover>
  )
})
