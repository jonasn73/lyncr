"use client"

/**
 * Reserved subtitle / count text — blank until settled so zeros never flash.
 * Use for pipeline headers, swimlane subtitles, KPI digits, empty-state gates.
 */

import { cn } from "@/lib/utils"
import { settledCountText } from "@/lib/settled-paint"

type SettledTextProps = {
  /** True while bootstrap/loading/validating — shows a non-breaking space. */
  pending: boolean
  /** Final copy when not pending (may include “0 …”). */
  children: string
  className?: string
  as?: "p" | "span" | "div"
}

/** Renders blank while pending, then `children`. Height-stable with min-h utilities from parent. */
export function SettledText({
  pending,
  children,
  className,
  as: Tag = "p",
}: SettledTextProps) {
  return (
    <Tag className={cn(className)}>
      {pending ? "\u00a0" : children}
    </Tag>
  )
}

type SettledCountProps = {
  pending: boolean
  count: number
  /** e.g. (n) => `${n} active job${n === 1 ? "" : "s"} today` */
  format: (n: number) => string
  className?: string
  as?: "p" | "span" | "div"
}

/** Count label with settled gate — shared by Scheduler, Map, Live status, etc. */
export function SettledCount({
  pending,
  count,
  format,
  className,
  as: Tag = "p",
}: SettledCountProps) {
  return (
    <Tag className={cn(className)}>
      {settledCountText(pending, count, format)}
    </Tag>
  )
}
