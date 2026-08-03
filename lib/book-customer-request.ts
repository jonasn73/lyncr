// Shared helpers for the public customer /book flow (details → ASAP or time window).
// Field names match Activity book-link + owner intake collected JSON so intake can auto-fill.

import { defaultIntakeScheduleDate } from "@/lib/intake-schedule-helpers"

/** Urgency chip: emergency skips availability; window asks for one day + from–to. */
export type BookUrgency = "asap" | "window"

/** Job chips — same ids as Activity /book/form. */
export const BOOK_JOB_KIND_OPTIONS = [
  { id: "lockout", label: "Lockout" },
  { id: "copy", label: "Car key — copy (have a working key)" },
  { id: "akl", label: "Car key — all keys lost (AKL)" },
  { id: "other", label: "Other" },
] as const

export type BookJobKindId = (typeof BOOK_JOB_KIND_OPTIONS)[number]["id"]

/** Map form job-kind chips → intake jobType string (client-safe — no server imports). */
export function jobTypeFromBookFormKind(jobKind: string): string {
  const k = jobKind.trim().toLowerCase()
  if (k === "copy") return "Key replacement (Duplication)"
  if (k === "akl") return "Key replacement (Origination)"
  if (k === "lockout") return "Lockout"
  if (k === "other") return "Service call"
  return "Service call"
}

/** One day chip for the availability step (today + next day, not a multi-day grid). */
export type BookDayOption = {
  dateKey: string
  label: string
  shortLabel: string
}

/** Half-hour choices for From / To selects (shop hours feel). */
export type BookTimeOption = {
  value: string // "13:00"
  label: string // "1:00 PM"
}

/** True when we should show year / make / model (lockout + car key). */
export function bookJobKindNeedsVehicle(jobKind: string): boolean {
  const k = jobKind.trim().toLowerCase()
  return k === "lockout" || k === "copy" || k === "akl"
}

/** Build Today + Tomorrow chips (and a third day if today is late evening). */
export function buildBookDayOptions(now: Date = new Date()): BookDayOption[] {
  const out: BookDayOption[] = []
  // Offer today + next calendar day (skip empty Sunday if you want — keep both for customers).
  for (let offset = 0; offset < 2; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    const dateKey = defaultIntakeScheduleDate(day)
    const weekday = day.toLocaleDateString(undefined, { weekday: "short" })
    const monthDay = day.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    out.push({
      dateKey,
      label: offset === 0 ? `Today · ${weekday} ${monthDay}` : `Next day · ${weekday} ${monthDay}`,
      shortLabel: offset === 0 ? "Today" : "Next day",
    })
  }
  return out
}

/** Format 24h "HH:MM" → "1:00 PM". */
export function formatBookTimeLabel(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(":")
  const h = Number(hRaw)
  const m = Number(mRaw)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm
  const period = h >= 12 ? "PM" : "AM"
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`
}

/** Half-hour options from startHour (inclusive) to endHour (exclusive end of last slot). */
export function buildBookTimeOptions(
  startHour = 7,
  endHour = 19,
  stepMinutes = 30
): BookTimeOption[] {
  const out: BookTimeOption[] = []
  const startMin = startHour * 60
  const endMin = endHour * 60
  for (let mins = startMin; mins <= endMin; mins += stepMinutes) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
    out.push({ value, label: formatBookTimeLabel(value) })
  }
  return out
}

/** Compare "HH:MM" strings as minutes-from-midnight. */
export function bookTimeToMinutes(hhmm: string): number {
  const [hRaw, mRaw] = hhmm.split(":")
  const h = Number(hRaw)
  const m = Number(mRaw)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN
  return h * 60 + m
}

/** True when from < to on the same day. */
export function isValidBookTimeRange(fromHhmm: string, toHhmm: string): boolean {
  const a = bookTimeToMinutes(fromHhmm)
  const b = bookTimeToMinutes(toHhmm)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return b > a
}

/**
 * Human line for notes + collected, e.g. "Today 1:00 PM–5:30 PM".
 * Owner intake reads `availability` / `availability_label`.
 */
export function formatBookAvailabilityLabel(params: {
  dateKey: string
  fromHhmm: string
  toHhmm: string
  dayShortLabel?: string
}): string {
  const day =
    params.dayShortLabel?.trim() ||
    (() => {
      const d = new Date(`${params.dateKey}T12:00:00`)
      if (Number.isNaN(d.getTime())) return params.dateKey
      return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    })()
  return `${day} ${formatBookTimeLabel(params.fromHhmm)}–${formatBookTimeLabel(params.toHhmm)}`
}

/** ISO start for deposit holds when the customer gave a window (use From time). */
export function bookWindowStartIso(dateKey: string, fromHhmm: string): string | null {
  const local = `${dateKey}T${fromHhmm}:00`
  const when = new Date(local)
  if (Number.isNaN(when.getTime())) return null
  return when.toISOString()
}

/** Default From/To: next half-hour → +4 hours (capped at shop close). */
export function defaultBookTimeRange(now: Date = new Date()): { from: string; to: string } {
  const options = buildBookTimeOptions(7, 19, 30)
  const nowMins = now.getHours() * 60 + now.getMinutes()
  // Round up to next half-hour option.
  let from = options.find((o) => bookTimeToMinutes(o.value) >= nowMins)?.value || "13:00"
  const fromMins = bookTimeToMinutes(from)
  const toTarget = fromMins + 4 * 60
  let to = options.find((o) => bookTimeToMinutes(o.value) >= toTarget)?.value || "17:30"
  if (!isValidBookTimeRange(from, to)) {
    from = "13:00"
    to = "17:30"
  }
  return { from, to }
}

/**
 * Keys written into ai_leads.collected so owner intake / CRM can prefill.
 * Keep names stable — parallel “schedule after Booked” work may read these.
 */
export function buildBookCollectedExtras(params: {
  urgency: BookUrgency
  email?: string | null
  jobKind?: string | null
  notes?: string | null
  availabilityDate?: string | null
  availabilityFrom?: string | null
  availabilityTo?: string | null
  availabilityLabel?: string | null
}): Record<string, unknown> {
  const urgency = params.urgency
  const isAsap = urgency === "asap"
  const extras: Record<string, unknown> = {
    urgency,
    is_asap: isAsap,
    // Mirror both names for older readers.
    customer_urgency: urgency,
  }
  const email = params.email?.trim()
  if (email) extras.customer_email = email
  const jobKind = params.jobKind?.trim()
  if (jobKind) extras.job_kind = jobKind
  const notes = params.notes?.trim()
  if (notes) extras.customer_notes = notes
  if (!isAsap) {
    const date = params.availabilityDate?.trim()
    const from = params.availabilityFrom?.trim()
    const to = params.availabilityTo?.trim()
    const label = params.availabilityLabel?.trim()
    if (date) extras.availability_date = date
    if (from) extras.availability_from = from
    if (to) extras.availability_to = to
    if (label) {
      extras.availability = label
      extras.availability_label = label
      extras.preferred_window = label
    }
  } else {
    extras.availability = "ASAP / emergency"
    extras.availability_label = "ASAP / emergency"
  }
  return extras
}
