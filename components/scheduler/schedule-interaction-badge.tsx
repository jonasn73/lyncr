"use client"

import { useLiveClock } from "@/lib/hooks/use-live-clock"
import {
  resolveScheduleInteractionPhase,
  SCHEDULE_INTERACTION_BADGE_CLASS,
  SCHEDULE_INTERACTION_LABEL,
  type ScheduleInteractionPhase,
} from "@/lib/scheduler-appointment-interaction"
import { cn } from "@/lib/utils"

type ScheduleInteractionBadgeProps = {
  scheduled_at: string | null | undefined
  job_status?: string | null
  now?: Date
  className?: string
}

export function ScheduleInteractionBadge({
  scheduled_at,
  job_status,
  now: nowProp,
  className,
}: ScheduleInteractionBadgeProps) {
  const tick = useLiveClock()
  const now = nowProp ?? tick
  const phase = resolveScheduleInteractionPhase({ now, scheduled_at, job_status })

  if (phase === "none" || phase === "completed") return null

  return (
    <span className={cn(SCHEDULE_INTERACTION_BADGE_CLASS[phase], className)}>
      {SCHEDULE_INTERACTION_LABEL[phase]}
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
