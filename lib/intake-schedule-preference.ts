// Shared schedule preference for live answered-call intake (matches public /book).
// Soft request: ASAP or one day + From–To — Scheduler hard-pins later.

import {
  buildBookCollectedExtras,
  bookWindowStartIso,
  defaultBookTimeRange,
  formatBookAvailabilityLabel,
  isValidBookTimeRange,
  type BookUrgency,
} from "@/lib/book-customer-request"

/** Operator urgency on the Schedule step (empty until they tap a chip). */
type IntakeScheduleUrgency = "" | BookUrgency

/** Fields the Schedule step reads/writes on the active-call form. */
export type IntakeScheduleFields = {
  scheduleUrgency: IntakeScheduleUrgency
  scheduledDate: string
  scheduledTime: string
  availabilityFrom: string
  availabilityTo: string
}

/** Empty / seed defaults for a new intake. */
export function emptyIntakeScheduleFields(): IntakeScheduleFields {
  const range = defaultBookTimeRange()
  return {
    scheduleUrgency: "",
    scheduledDate: "",
    scheduledTime: "",
    availabilityFrom: range.from,
    availabilityTo: range.to,
  }
}

/** True when Schedule is ready to book (ASAP, or a valid day window). */
export function isIntakeSchedulePreferenceReady(
  form: Partial<IntakeScheduleFields> & {
    scheduledDate?: string
    scheduledTime?: string
  }
): boolean {
  const urgency = String(form.scheduleUrgency ?? "").trim()
  if (urgency === "asap") return true
  if (urgency === "window") {
    const date = String(form.scheduledDate ?? "").trim()
    const from = String(form.availabilityFrom ?? "").trim()
    const to = String(form.availabilityTo ?? "").trim()
    return Boolean(date && isValidBookTimeRange(from, to))
  }
  // Legacy drafts: exact date + time before ASAP/window existed.
  return Boolean(
    String(form.scheduledDate ?? "").trim() && String(form.scheduledTime ?? "").trim()
  )
}

/** Human label for complete / confirm SMS / CRM chips (never invents a fake pin). */
export function formatIntakeScheduleSummary(
  form: Partial<IntakeScheduleFields> & {
    scheduledDate?: string
    scheduledTime?: string
  }
): string | null {
  const urgency = String(form.scheduleUrgency ?? "").trim()
  if (urgency === "asap") return "ASAP / emergency"
  if (urgency === "window") {
    const date = String(form.scheduledDate ?? "").trim()
    const from = String(form.availabilityFrom ?? "").trim()
    const to = String(form.availabilityTo ?? "").trim()
    if (!date || !isValidBookTimeRange(from, to)) return null
    return formatBookAvailabilityLabel({
      dateKey: date,
      fromHhmm: from,
      toHhmm: to,
    })
  }
  const date = String(form.scheduledDate ?? "").trim()
  const time = String(form.scheduledTime ?? "").trim()
  if (date && time) return `${date} at ${time}`
  return null
}

/**
 * Soft pin for ai_leads.scheduled_at:
 * - ASAP → null
 * - Window → From time (same as /book checkout)
 * - Legacy exact time → that local datetime
 */
export function intakeScheduleSoftPinIso(
  form: Partial<IntakeScheduleFields> & {
    scheduledDate?: string
    scheduledTime?: string
  }
): string | null {
  const urgency = String(form.scheduleUrgency ?? "").trim()
  if (urgency === "asap") return null
  if (urgency === "window") {
    const date = String(form.scheduledDate ?? "").trim()
    const from = String(form.availabilityFrom ?? "").trim()
    if (!date || !from) return null
    return bookWindowStartIso(date, from)
  }
  const date = String(form.scheduledDate ?? "").trim()
  const time = String(form.scheduledTime ?? "").trim()
  if (!date || !time) return null
  return bookWindowStartIso(date, time)
}

/** collected extras for create-intake-job (same keys as public /book). */
export function buildIntakeScheduleCollectedExtras(
  form: Partial<IntakeScheduleFields> & {
    scheduledDate?: string
    scheduledTime?: string
  }
): Record<string, unknown> | null {
  const urgency = String(form.scheduleUrgency ?? "").trim()
  if (urgency !== "asap" && urgency !== "window") {
    // Legacy exact pin — still stamp a window-shaped label when possible.
    const date = String(form.scheduledDate ?? "").trim()
    const time = String(form.scheduledTime ?? "").trim()
    if (!date || !time) return null
    const label = `${date} at ${time}`
    return buildBookCollectedExtras({
      urgency: "window",
      availabilityDate: date,
      availabilityFrom: time,
      availabilityTo: time,
      availabilityLabel: label,
    })
  }
  const label = formatIntakeScheduleSummary(form)
  return buildBookCollectedExtras({
    urgency: urgency as BookUrgency,
    availabilityDate: urgency === "window" ? form.scheduledDate : null,
    availabilityFrom: urgency === "window" ? form.availabilityFrom : null,
    availabilityTo: urgency === "window" ? form.availabilityTo : null,
    availabilityLabel: label,
  })
}

/**
 * Normalize older drafts that only had scheduledDate/Time.
 * Keeps Restore working without forcing the operator to re-pick.
 */
export function normalizeIntakeScheduleFields(
  form: Partial<IntakeScheduleFields> & {
    scheduledDate?: string
    scheduledTime?: string
  }
): IntakeScheduleFields {
  const empty = emptyIntakeScheduleFields()
  const urgencyRaw = String(form.scheduleUrgency ?? "").trim()
  const urgency: IntakeScheduleUrgency =
    urgencyRaw === "asap" || urgencyRaw === "window" ? urgencyRaw : ""
  const date = String(form.scheduledDate ?? "").trim()
  const time = String(form.scheduledTime ?? "").trim()
  const from =
    String(form.availabilityFrom ?? "").trim() || time || empty.availabilityFrom
  const to = String(form.availabilityTo ?? "").trim() || empty.availabilityTo

  if (urgency) {
    return {
      scheduleUrgency: urgency,
      scheduledDate: date,
      scheduledTime: urgency === "window" ? from : time,
      availabilityFrom: from,
      availabilityTo: to,
    }
  }

  // Legacy: date+time already filled → treat as a confirmed window start.
  if (date && time) {
    const range = defaultBookTimeRange()
    const legacyTo =
      String(form.availabilityTo ?? "").trim() ||
      (isValidBookTimeRange(time, range.to) ? range.to : to)
    return {
      scheduleUrgency: "window",
      scheduledDate: date,
      scheduledTime: time,
      availabilityFrom: time,
      availabilityTo: isValidBookTimeRange(time, legacyTo) ? legacyTo : to,
    }
  }

  return {
    scheduleUrgency: "",
    scheduledDate: date,
    scheduledTime: time,
    availabilityFrom: from,
    availabilityTo: to,
  }
}
