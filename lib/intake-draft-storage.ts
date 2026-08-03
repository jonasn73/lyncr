// Local draft persistence for answered-call intake — keyed by caller phone number.

import type { ActiveCallFormState } from "@/lib/hooks/use-active-call-form"

/** Manual intake micro-step ids stored with each draft. */
export type IntakeDraftWorkflowStep =
  | "SERVICE_SELECT"
  | "VEHICLE_INFO"
  | "JOB_TYPE"
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
  /**
   * call_logs.id (or manual row id) that was open when this draft was saved.
   * Used so a brand-new inbound leg treats the prior draft as optional.
   */
  sourceCallLogId?: string | null
  /**
   * Normalized phone key this draft was written under (e.g. "15023145391").
   * Restore must match this to the open call — never show another caller's draft.
   */
  callerPhoneKey?: string | null
}

const STORAGE_VERSION = 1

/** Drafts older than this are treated as stale and ignored on open. */
export const INTAKE_DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000

/**
 * Soft window for “same session continue” — drafts older than this on a *new*
 * call leg are still restorable but should not dominate the decision card.
 */
export const INTAKE_DRAFT_NEW_CALL_SOFT_AGE_MS = 30 * 60 * 1000

type StoredEnvelope = {
  v: number
  data: IntakeDraftSnapshot
}

/**
 * Normalize to a stable US key: exactly 10 digits, or 11 starting with 1.
 * Rejects longer digit strings (avoids accidental cross-caller keys).
 */
export function normalizeIntakeDraftPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return digits
  if (digits.length === 10) return `1${digits}`
  return null
}

/** True when we have enough digits to key a draft. */
export function isValidIntakeDraftPhone(phone: string): boolean {
  return normalizeIntakeDraftPhone(phone) != null
}

/**
 * Strict phone equality for draft offer / restore.
 * Prefers full normalized keys; falls back to last-10 only when both normalize.
 */
export function intakeDraftPhonesMatch(a: string, b: string): boolean {
  const na = normalizeIntakeDraftPhone(a)
  const nb = normalizeIntakeDraftPhone(b)
  if (!na || !nb) return false
  return na === nb
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
    value === "JOB_TYPE" ||
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

/** True when the form has operator-entered fields (not just a wizard step id). */
function intakeDraftHasFieldProgress(form: ActiveCallFormState): boolean {
  if (form.vehicleYear?.trim() || form.vehicleMake?.trim() || form.vehicleModel?.trim()) {
    return true
  }
  if (form.addressLine1?.trim() || form.city?.trim() || form.postalCode?.trim()) return true
  if (form.notes?.trim()) return true
  if (form.plateNumber?.trim() || form.vehicleVin?.trim()) return true
  // CNAM / caller_name alone must NOT count — every inbound can have a display name.

  const service = String(form.serviceQuoteTypeId ?? "").trim()
  const jobType = String(form.jobType ?? "").trim()
  const isDefaultLockoutShell = !service || service === "lockout"

  // Ignore auto jobType "Lockout" from the blank-form calculator default.
  if (jobType && !(isDefaultLockoutShell && /^lockout$/i.test(jobType))) {
    return true
  }
  // Operator-locked price counts; auto Lockout estimate dollars do not.
  if (form.quotedPriceOverridden) return true
  if ((form.quotedPriceCents ?? 0) > 0 && !isDefaultLockoutShell) return true

  // Empty or default Lockout alone = no field progress.
  if (service && service !== "lockout") return true
  return false
}

/**
 * True when the draft has real operator progress — not just the blank Service
 * screen with default Lockout (or empty service) and empty fields.
 *
 * Important: the quote calculator auto-fills jobType "Lockout" + a dollar total
 * whenever service is lockout. Those alone must NOT count as meaningful, or every
 * new inbound gets a false "Returning caller / Restore draft" card.
 *
 * Also: a mid-flow step id with a blank form (call-switch race before Service
 * resets) must NOT count — that was seeding "Saved draft from just now" on
 * brand-new numbers.
 */
export function isIntakeDraftMeaningful(
  draft: Pick<IntakeDraftSnapshot, "form" | "currentStep">
): boolean {
  const { form, currentStep } = draft
  if (currentStep === "BOOKING_COMPLETE") return false

  const hasFields = intakeDraftHasFieldProgress(form)
  const service = String(form.serviceQuoteTypeId ?? "").trim()

  // Mid-flow only counts when they actually picked a service or entered fields.
  // Empty shell stuck on Address/Vehicle after a call switch is NOT progress.
  if (currentStep !== "SERVICE_SELECT") {
    return hasFields || Boolean(service)
  }

  return hasFields
}

/**
 * True when this draft belongs to the given caller phone (normalized).
 * Prefers explicit callerPhoneKey; falls back to form.phoneNumber.
 * Missing/mismatched identity → false (do not offer Restore).
 */
export function intakeDraftBelongsToPhone(
  draft: Pick<IntakeDraftSnapshot, "form" | "callerPhoneKey">,
  phone: string
): boolean {
  const expected = normalizeIntakeDraftPhone(phone)
  if (!expected) return false
  const key = String(draft.callerPhoneKey ?? "").trim()
  if (key) return key === expected
  const formPhone = draft.form.phoneNumber?.trim() || ""
  if (!formPhone) return false
  return intakeDraftPhonesMatch(formPhone, phone)
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

/**
 * True when this draft should be offered as Restore on the open intake sheet.
 * Requires: fresh, not submitted, not complete, and meaningful progress.
 */
export function isIntakeDraftRestorable(draft: IntakeDraftSnapshot, nowMs: number = Date.now()): boolean {
  if (draft.submitted) return false
  if (draft.currentStep === "BOOKING_COMPLETE") return false
  if (!isIntakeDraftMeaningful(draft)) return false
  return isIntakeDraftFresh(draft, nowMs)
}

/**
 * True when Restore should be a secondary action (new inbound leg / soft-aged draft),
 * not the primary path blocking New job.
 */
export function isIntakeDraftRestoreSecondary(
  draft: Pick<IntakeDraftSnapshot, "savedAt" | "sourceCallLogId">,
  currentCallLogId: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  const currentId = String(currentCallLogId ?? "").trim()
  const sourceId = String(draft.sourceCallLogId ?? "").trim()
  // Same open call leg (refresh / crash mid-intake) → Restore can stay prominent.
  if (currentId && sourceId && currentId === sourceId) return false
  // No source id (legacy) or a different call leg → optional continue, not forced.
  if (!sourceId || !currentId || sourceId !== currentId) return true
  const saved = new Date(draft.savedAt).getTime()
  if (!Number.isFinite(saved)) return true
  return nowMs - saved > INTAKE_DRAFT_NEW_CALL_SOFT_AGE_MS
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
      sourceCallLogId:
        typeof data.sourceCallLogId === "string" && data.sourceCallLogId.trim()
          ? data.sourceCallLogId.trim()
          : null,
      callerPhoneKey:
        typeof data.callerPhoneKey === "string" && data.callerPhoneKey.trim()
          ? data.callerPhoneKey.trim()
          : null,
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
 * meaningful, not submitted, and not already on the booking-complete step.
 * Always requires the draft to belong to this exact phone (never cross-caller).
 */
export function getDraftByPhoneNumber(phone: string): IntakeDraftSnapshot | null {
  const draft = loadIntakeDraft(phone)
  if (!draft) return null
  // Wrong-number / missing identity drafts must not surface as Restore.
  if (!intakeDraftBelongsToPhone(draft, phone)) {
    clearIntakeDraft(phone)
    return null
  }
  if (!isIntakeDraftRestorable(draft)) {
    // Drop stale / submitted / thin entries so the next call starts clean.
    if (draft.submitted || !isIntakeDraftFresh(draft) || !isIntakeDraftMeaningful(draft)) {
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
  const callerPhoneKey = normalizeIntakeDraftPhone(phone)
  if (!key || !callerPhoneKey) return
  // Never write under phone A while the form still belongs to phone B (or is empty).
  if (!intakeDraftBelongsToPhone({ form: snapshot.form, callerPhoneKey: null }, phone)) {
    return
  }
  // Never persist empty Service + Lockout shells — they cause false Restore prompts.
  if (
    !isIntakeDraftMeaningful({
      form: snapshot.form,
      currentStep: normalizeIntakeDraftStep(snapshot.currentStep),
    })
  ) {
    return
  }
  try {
    const envelope: StoredEnvelope = {
      v: STORAGE_VERSION,
      data: {
        ...snapshot,
        currentStep: normalizeIntakeDraftStep(snapshot.currentStep),
        submitted: Boolean(snapshot.submitted),
        sourceCallLogId:
          typeof snapshot.sourceCallLogId === "string" && snapshot.sourceCallLogId.trim()
            ? snapshot.sourceCallLogId.trim()
            : snapshot.sourceCallLogId ?? null,
        callerPhoneKey,
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
