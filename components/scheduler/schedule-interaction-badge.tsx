"use client"

import { useLiveClock } from "@/lib/hooks/use-live-clock"
import {
  resolveScheduleInteractionPhase,
  SCHEDULE_INTERACTION_BADGE_CLASS,
  SCHEDULE_INTERACTION_DOT_CLASS,
  SCHEDULE_INTERACTION_LABEL,
  type ScheduleInteractionPhase,
} from "@/lib/scheduler-appointment-interaction"
import { cn } from "@/lib/utils"

type ScheduleInteractionBadgeProps = {
  scheduled_at: string | null | undefined
  job_status?: string | null
  now?: Date
  className?: string
  /** Dot-only mode for ultra-compact cards. */
  compact?: boolean
}

export function ScheduleInteractionBadge({
  scheduled_at,
  job_status,
  now: nowProp,
  className,
  compact = false,
}: ScheduleInteractionBadgeProps) {
  const tick = useLiveClock()
  const now = nowProp ?? tick
  const phase = resolveScheduleInteractionPhase({ now, scheduled_at, job_status })

  if (phase === "none" || phase === "completed") return null

  const label = SCHEDULE_INTERACTION_LABEL[phase]

  return (
    <span
      className={cn(SCHEDULE_INTERACTION_BADGE_CLASS[phase], className)}
      title={label}
      aria-label={label}
    >
      <span className={SCHEDULE_INTERACTION_DOT_CLASS[phase]} aria-hidden />
      {compact ? null : <span>{label}</span>}
    </span>
  )
}

export function useScheduleInteractionPhase(params: {
  scheduled_at: string | null | undefined
  job_status?: string | null
}): ScheduleInteractionPhase {
  const now = useLiveClock()
  return resolveScheduleInteractionPhase({
    now,
    scheduled_at: params.scheduled_at,
    job_status: params.job_status,
  })
}
