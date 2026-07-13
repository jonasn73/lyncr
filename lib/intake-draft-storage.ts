// Local draft persistence for answered-call intake — keyed by caller phone number.

import type { ActiveCallFormState } from "@/lib/hooks/use-active-call-form"

/** Manual intake micro-step ids stored with each draft. */
export type IntakeDraftWorkflowStep =
  | "SERVICE_SELECT"
  | "VEHICLE_INFO"
  | "KEY_SPECIFICS"
  | "ADDRESS_CONTACT"
  | "SCHEDULE_TIME"
  | "CUSTOMER_NAME"
  | "BOOKING_COMPLETE"
  | "FINAL_DISPATCH" // legacy drafts — mapped to SCHEDULE_TIME on load

/** Everything needed to resume intake when the same customer calls back. */
export type IntakeDraftSnapshot = {
  form: ActiveCallFormState
  currentStep: IntakeDraftWorkflowStep
  customPrice: string
  failureReason: string
  recoveredViaRouteDiscount: boolean
  negotiationStep: number
  savedAt: string
  /** True after Finalize & Secure Appointment — never auto-restore. */
  submitted?: boolean
}

const STORAGE_VERSION = 1

/** Drafts older than this are treated as stale and ignored on open. */
export const INTAKE_DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000

type StoredEnvelope = {
  v: number
  data: IntakeDraftSnapshot
}

/** Normalize to stable US digits for storage keys (10 or 11 digits). */
export function normalizeIntakeDraftPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return digits
  if (digits.length === 10) return `1${digits}`
  if (digits.length > 11) return digits.slice(-11)
  return null
}

/** True when we have enough digits to key a draft. */
export function isValidIntakeDraftPhone(phone: string): boolean {
  return normalizeIntakeDraftPhone(phone) != null
}

/** Browser localStorage key for a caller phone. */
export function intakeDraftStorageKey(phone: string): string | null {
  const normalized = normalizeIntakeDraftPhone(phone)
  return normalized ? `intake_draft_${normalized}` : null
}

function isWorkflowStep(value: unknown): value is IntakeDraftWorkflowStep {
  return (
    value === "SERVICE_SELECT" ||
    value === "VEHICLE_INFO" ||
    value === "KEY_SPECIFICS" ||
    value === "ADDRESS_CONTACT" ||
    value === "SCHEDULE_TIME" ||
    value === "CUSTOMER_NAME" ||
    value === "BOOKING_COMPLETE" ||
    value === "FINAL_DISPATCH"
  )
}

/** Map legacy FINAL_DISPATCH drafts onto the new schedule step. */
export function normalizeIntakeDraftStep(step: IntakeDraftWorkflowStep): IntakeDraftWorkflowStep {
  if (step === "FINAL_DISPATCH") return "SCHEDULE_TIME"
  return step
}

function isFormSnapshot(value: unknown): value is ActiveCallFormState {
  if (!value || typeof value !== "object") return false
  const form = value as Partial<ActiveCallFormState>
  return (
    typeof form.phoneNumber === "string" &&
    typeof form.displayName === "string" &&
    typeof form.serviceQuoteTypeId === "string" &&
    Array.isArray(form.vehicleClarificationAnswers)
  )
}

/** True when the draft is recent enough to resume (default: under 2 hours). */
export function isIntakeDraftFresh(
  draft: Pick<IntakeDraftSnapshot, "savedAt">,
  nowMs: number = Date.now()
): boolean {
  const saved = new Date(draft.savedAt).getTime()
  if (!Number.isFinite(saved)) return false
  return nowMs - saved <= INTAKE_DRAFT_MAX_AGE_MS
}

/** True when this draft should hydrate the open intake sheet. */
export function isIntakeDraftRestorable(draft: IntakeDraftSnapshot, nowMs: number = Date.now()): boolean {
  if (draft.submitted) return false
  if (draft.currentStep === "BOOKING_COMPLETE") return false
  return isIntakeDraftFresh(draft, nowMs)
}

function parseStoredDraft(raw: string): IntakeDraftSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as StoredEnvelope | IntakeDraftSnapshot
    const data: IntakeDraftSnapshot =
      "v" in parsed && parsed.v === STORAGE_VERSION && "data" in parsed
        ? parsed.data
        : (parsed as IntakeDraftSnapshot)
    if (!data || typeof data !== "object") return null
    if (!isFormSnapshot(data.form)) return null
    if (!isWorkflowStep(data.currentStep)) return null
    return {
      form: data.form,
      currentStep: normalizeIntakeDraftStep(data.currentStep),
      customPrice: typeof data.customPrice === "string" ? data.customPrice : "",
      failureReason: typeof data.failureReason === "string" ? data.failureReason : "__neutral__",
      recoveredViaRouteDiscount: Boolean(data.recoveredViaRouteDiscount),
      negotiationStep: typeof data.negotiationStep === "number" ? data.negotiationStep : 1,
      savedAt: typeof data.savedAt === "string" ? data.savedAt : new Date().toISOString(),
      submitted: Boolean(data.submitted),
    }
  } catch {
    return null
  }
}

/** Parse a stored draft; returns null when missing or corrupt (does not apply TTL). */
export function loadIntakeDraft(phone: string): IntakeDraftSnapshot | null {
  if (typeof localStorage === "undefined") return null
  const key = intakeDraftStorageKey(phone)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return parseStoredDraft(raw)
  } catch {
    return null
  }
}

/**
 * Resume helper for intake open — only returns a draft that is fresh,
 * not submitted, and not already on the booking-complete step.
 */
export function getDraftByPhoneNumber(phone: string): IntakeDraftSnapshot | null {
  const draft = loadIntakeDraft(phone)
  if (!draft) return null
  if (!isIntakeDraftRestorable(draft)) {
    // Drop stale / submitted entries so the next call starts clean.
    if (draft.submitted || !isIntakeDraftFresh(draft)) {
      clearIntakeDraft(phone)
    }
    return null
  }
  return draft
}

/** Persist the active intake snapshot for this phone number. */
export function saveIntakeDraft(
  phone: string,
  snapshot: Omit<IntakeDraftSnapshot, "savedAt"> & { savedAt?: string }
): void {
  if (typeof localStorage === "undefined") return
  const key = intakeDraftStorageKey(phone)
  if (!key) return
  try {
    const envelope: StoredEnvelope = {
      v: STORAGE_VERSION,
      data: {
        ...snapshot,
        currentStep: normalizeIntakeDraftStep(snapshot.currentStep),
        submitted: Boolean(snapshot.submitted),
        savedAt: snapshot.savedAt || new Date().toISOString(),
      },
    }
    localStorage.setItem(key, JSON.stringify(envelope))
  } catch {
    /* private mode / quota — ignore */
  }
}

/** Remove the saved draft when dispatch dismisses or completes intake. */
export function clearIntakeDraft(phone: string): void {
  if (typeof localStorage === "undefined") return
  const key = intakeDraftStorageKey(phone)
  if (!key) return
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
