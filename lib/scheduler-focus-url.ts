// Deep-link helpers for the owner scheduler (intake dispatch → schedule a new pool job).

/** Query param: lead id to highlight on the map or in the hopper. */
export const SCHEDULER_FOCUS_PARAM = "focus"

/** Query param: open grid scheduling UI for a newly created pool job. */
export const SCHEDULER_SCHEDULE_PARAM = "schedule"

export type SchedulerFocusUrlOptions = {
  /** When true, open the post-intake schedule dialog (date + time) on the map. */
  schedule?: boolean
}

/** Build `/dashboard/scheduler?focus=…&schedule=1` for post-intake dispatch. */
export function buildSchedulerFocusUrl(leadId: string, options?: SchedulerFocusUrlOptions): string {
  const id = leadId.trim()
  const params = new URLSearchParams()
  params.set(SCHEDULER_FOCUS_PARAM, id)
  if (options?.schedule) {
    params.set(SCHEDULER_SCHEDULE_PARAM, "1")
  }
  return `/dashboard/scheduler?${params.toString()}`
}

/** Read `focus` and `schedule` from the current URL search string. */
export function parseSchedulerFocusSearch(search: string): {
  focusLeadId: string | null
  scheduleFromIntake: boolean
} {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  const focusLeadId = params.get(SCHEDULER_FOCUS_PARAM)?.trim() || null
  const scheduleFromIntake = params.get(SCHEDULER_SCHEDULE_PARAM) === "1"
  return { focusLeadId, scheduleFromIntake }
}

/** True when a `datetime-local` value is complete enough to save (YYYY-MM-DDTHH:mm). */
export function isCompleteDatetimeLocalValue(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 16) return false
  const parsed = Date.parse(trimmed)
  return !Number.isNaN(parsed)
}

/** Future calendar day, or today with a concrete clock time picked. */
export function shouldAutoAdvanceAfterSchedulePick(value: string): boolean {
  if (!isCompleteDatetimeLocalValue(value)) return false
  const picked = new Date(value)
  const now = new Date()
  const pickedDay = `${picked.getFullYear()}-${picked.getMonth()}-${picked.getDate()}`
  const todayDay = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  if (pickedDay !== todayDay) return true
  return picked.getTime() > now.getTime()
}
