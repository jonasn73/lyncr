// Deep-link helpers for the owner scheduler (intake dispatch → schedule a new pool job).

/** Query param: lead id to highlight on the map or in the hopper. */
export const SCHEDULER_FOCUS_PARAM = "focus"

/** Query param: open grid scheduling UI for a newly created pool job. */
export const SCHEDULER_SCHEDULE_PARAM = "schedule"

/** Query param: journey started in CRM — drawer close returns to customers. */
export const SCHEDULER_FROM_PARAM = "from"

/** Query param: CRM customer id to reopen after returning from Scheduler. */
export const SCHEDULER_CUSTOMER_PARAM = "customer"

export type SchedulerFocusUrlOptions = {
  /** When true, open the post-intake schedule dialog (date + time) on the map. */
  schedule?: boolean
  /** When true, closing the job drawer returns to CRM customers. */
  fromCrm?: boolean
  /**
   * When true, closing the job drawer restores intake PiP / expand
   * (View job / Recent Job Active from an active call).
   */
  fromIntake?: boolean
  /** CRM customer id — reopens that profile when returning from Scheduler. */
  customerId?: string | null
}

/** Build `/dashboard/scheduler?focus=…&schedule=1` for post-intake dispatch. */
export function buildSchedulerFocusUrl(leadId: string, options?: SchedulerFocusUrlOptions): string {
  const id = leadId.trim()
  const params = new URLSearchParams()
  params.set(SCHEDULER_FOCUS_PARAM, id)
  if (options?.schedule) {
    params.set(SCHEDULER_SCHEDULE_PARAM, "1")
  }
  // CRM wins if both are set — Book/Open/View return to the customer profile.
  if (options?.fromCrm) {
    params.set(SCHEDULER_FROM_PARAM, "crm")
    const customerId = options.customerId?.trim()
    if (customerId) {
      params.set(SCHEDULER_CUSTOMER_PARAM, customerId)
    }
  } else if (options?.fromIntake) {
    params.set(SCHEDULER_FROM_PARAM, "intake")
  }
  return `/dashboard/scheduler?${params.toString()}`
}

/** Build CRM customers URL, optionally reopening a profile. */
export function buildCrmReturnUrl(customerId?: string | null): string {
  const id = customerId?.trim()
  if (!id) return "/dashboard/customers"
  return `/dashboard/customers?customer=${encodeURIComponent(id)}`
}

/** Read `focus`, `schedule`, and CRM / intake return context from the current URL search string. */
export function parseSchedulerFocusSearch(search: string): {
  focusLeadId: string | null
  scheduleFromIntake: boolean
  fromCrm: boolean
  fromIntake: boolean
  customerId: string | null
} {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  const focusLeadId = params.get(SCHEDULER_FOCUS_PARAM)?.trim() || null
  const scheduleFromIntake = params.get(SCHEDULER_SCHEDULE_PARAM) === "1"
  const fromRaw = (params.get(SCHEDULER_FROM_PARAM) ?? "").trim().toLowerCase()
  const fromCrm = fromRaw === "crm"
  const fromIntake = fromRaw === "intake"
  const customerId = params.get(SCHEDULER_CUSTOMER_PARAM)?.trim() || null
  return { focusLeadId, scheduleFromIntake, fromCrm, fromIntake, customerId }
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
