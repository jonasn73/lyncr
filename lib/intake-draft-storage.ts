// Local draft persistence for answered-call intake — keyed by caller phone number.

import type { ActiveCallFormState } from "@/lib/hooks/use-active-call-form"

/** Manual intake micro-step ids stored with each draft. */
export type IntakeDraftWorkflowStep =
  | "SERVICE_SELECT"
  | "VEHICLE_INFO"
  | "KEY_SPECIFICS"
  | "ADDRESS_CONTACT"
  | "FINAL_DISPATCH"

/** Everything needed to resume intake when the same customer calls back. */
export type IntakeDraftSnapshot = {
  form: ActiveCallFormState
  currentStep: IntakeDraftWorkflowStep
  customPrice: string
  failureReason: string
  recoveredViaRouteDiscount: boolean
  negotiationStep: number
  savedAt: string
}

const STORAGE_VERSION = 1

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
    value === "FINAL_DISPATCH"
  )
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

/** Parse a stored draft; returns null when missing or corrupt. */
export function loadIntakeDraft(phone: string): IntakeDraftSnapshot | null {
  if (typeof localStorage === "undefined") return null
  const key = intakeDraftStorageKey(phone)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredEnvelope | IntakeDraftSnapshot
    const data = "v" in parsed && parsed.v === STORAGE_VERSION ? parsed.data : parsed
    if (!data || typeof data !== "object") return null
    if (!isFormSnapshot(data.form)) return null
    if (!isWorkflowStep(data.currentStep)) return null
    return {
      form: data.form,
      currentStep: data.currentStep,
      customPrice: typeof data.customPrice === "string" ? data.customPrice : "",
      failureReason: typeof data.failureReason === "string" ? data.failureReason : "__neutral__",
      recoveredViaRouteDiscount: Boolean(data.recoveredViaRouteDiscount),
      negotiationStep: typeof data.negotiationStep === "number" ? data.negotiationStep : 1,
      savedAt: typeof data.savedAt === "string" ? data.savedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/** Persist the active intake snapshot for this phone number. */
export function saveIntakeDraft(phone: string, snapshot: Omit<IntakeDraftSnapshot, "savedAt">): void {
  if (typeof localStorage === "undefined") return
  const key = intakeDraftStorageKey(phone)
  if (!key) return
  try {
    const envelope: StoredEnvelope = {
      v: STORAGE_VERSION,
      data: { ...snapshot, savedAt: new Date().toISOString() },
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
