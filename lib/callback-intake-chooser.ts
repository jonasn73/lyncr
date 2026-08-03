// Returning-caller / callback intake helpers — chooser step + service prefill from CRM.

import { serviceQuoteTypeFromJobType, serviceTypeRequiresVehicle } from "@/lib/job-intake-fields"
import {
  SERVICE_QUOTE_TYPE_IDS,
  type ServiceQuoteTypeId,
} from "@/lib/service-rate-card"
import { serviceQuoteTypeIdFromIntake } from "@/lib/service-quote-calculator"

/** CRM open-lead fields used to continue a quote (upgrade-on-book). */
export type OpenQuotePrefillSource = {
  service_quote_type_id?: string | null
  job_type?: string | null
  summary?: string | null
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  amount_cents?: number | null
}

/**
 * Resolve a real calculator id from CRM history — never invents Lockout from blanks.
 * Empty / missing stored type returns null so intake can clear the false Lockout default.
 */
export function serviceQuoteTypeIdFromCrmHistory(
  item: OpenQuotePrefillSource | null | undefined
): ServiceQuoteTypeId | null {
  if (!item) return null
  const rawId = String(item.service_quote_type_id ?? "").trim()
  if (rawId && (SERVICE_QUOTE_TYPE_IDS as readonly string[]).includes(rawId)) {
    return rawId as ServiceQuoteTypeId
  }
  // Legacy aliases stored before the current enum.
  if (rawId === "key_gen") return "key_generation"
  if (rawId === "key_dup") return "key_duplication"
  if (rawId === "ignition") return "ignition_repair"

  const jobType = String(item.job_type ?? "").trim()
  if (jobType) {
    const fromJob = serviceQuoteTypeFromJobType(jobType)
    // serviceQuoteTypeFromJobType falls through to "other" for unknown labels — keep that.
    if (fromJob !== "other" || /other/i.test(jobType)) return fromJob
    // Unknown job_type string that mapped to other — still useful if it was Key replacement etc.
    const intakeGuess = serviceQuoteTypeIdFromIntake(jobType, "")
    if (intakeGuess !== "other") return intakeGuess
    return fromJob
  }

  const summary = String(item.summary ?? "").trim().toLowerCase()
  if (summary) {
    // Summary lines are free text — match common key phrases before the exact intake labels.
    if (summary.includes("key replacement") || summary.includes("all keys lost") || summary.includes("akl")) {
      return "key_generation"
    }
    if (summary.includes("duplication") || summary.includes("spare key")) {
      return "key_duplication"
    }
    if (summary.includes("lockout")) return "lockout"
    const fromSummary = serviceQuoteTypeIdFromIntake(summary, "")
    if (fromSummary !== "other") return fromSummary
  }
  return null
}

/** Manual intake steps the Continue-quote path may land on. */
export type CallbackContinueStep =
  | "SERVICE_SELECT"
  | "VEHICLE_INFO"
  | "ADDRESS_CONTACT"
  | "SCHEDULE_TIME"
  | "CUSTOMER_NAME"

/**
 * After Continue open quote: skip filled steps; land on the first incomplete one.
 * Service → Vehicle (YMM) → Address → Customer (name / quote / outcomes) → Schedule → book.
 */
export function continueOpenQuoteStep(params: {
  serviceTypeId: ServiceQuoteTypeId | ""
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
  addressReady: boolean
  /** Caller name — Customer step comes before Schedule. */
  displayName?: string
  /** When both set (and name ready), Schedule is done — stay on Schedule to finalize. */
  scheduledDate?: string
  scheduledTime?: string
}): CallbackContinueStep {
  const serviceId = (params.serviceTypeId || "") as ServiceQuoteTypeId | ""
  // Unknown type — show Service wizard (decision card already dismissed).
  if (!serviceId) return "SERVICE_SELECT"
  const ymmComplete = Boolean(
    params.vehicleYear.trim() && params.vehicleMake.trim() && params.vehicleModel.trim()
  )
  // Key / ignition / lockout-with-vehicle paths still need YMM confirm when empty.
  if (serviceTypeRequiresVehicle(serviceId) && !ymmComplete) {
    return "VEHICLE_INFO"
  }
  // Lockout with garage YMM missing — still confirm vehicle before address.
  if (serviceId === "lockout" && !ymmComplete) {
    return "VEHICLE_INFO"
  }
  if (!params.addressReady) return "ADDRESS_CONTACT"
  const nameReady = Boolean(String(params.displayName ?? "").trim())
  // Quote / outcomes before picking a time — Booked then advances to Schedule.
  if (!nameReady) return "CUSTOMER_NAME"
  const scheduleReady = Boolean(
    String(params.scheduledDate ?? "").trim() && String(params.scheduledTime ?? "").trim()
  )
  // Name filled but no date/time yet — land on Schedule to secure the appointment.
  if (!scheduleReady) return "SCHEDULE_TIME"
  return "SCHEDULE_TIME"
}

/** Draft / wizard step order — higher means further along the intake path. */
const DRAFT_RESUME_STEP_ORDER: Record<string, number> = {
  SERVICE_SELECT: 0,
  // Live-call flow: Copy/AKL before YMM (KEY_SPECIFICS kept for old drafts only)
  JOB_TYPE: 1,
  VEHICLE_INFO: 2,
  KEY_SPECIFICS: 3,
  ADDRESS_CONTACT: 4,
  // Customer (quote) before Schedule — matches live-call Booked → Schedule flow
  CUSTOMER_NAME: 5,
  SCHEDULE_TIME: 6,
  BOOKING_COMPLETE: 7,
  FINAL_DISPATCH: 6, // legacy alias of SCHEDULE_TIME
}

/** Steps Restore may land on (Continue-quote set + mid-flow key/name steps). */
export type DraftResumeStep =
  | CallbackContinueStep
  | "JOB_TYPE"
  | "KEY_SPECIFICS"
  | "CUSTOMER_NAME"

/**
 * True when Lockout looks intentional — not just the blank-form default autosaved on Service.
 * Mirror Continue-quote: clear false Lockout unless notes/job type/step prove a real pick.
 */
export function draftClearlyChoseLockout(
  form: {
    serviceQuoteTypeId?: string | null
    notes?: string | null
    jobType?: string | null
  },
  savedStep?: string | null
): boolean {
  if (String(form.serviceQuoteTypeId ?? "").trim() !== "lockout") return false
  const notes = String(form.notes ?? "")
  const jobType = String(form.jobType ?? "")
  if (/lockout/i.test(notes) || /lockout/i.test(jobType)) return true
  const step = String(savedStep ?? "SERVICE_SELECT").trim() || "SERVICE_SELECT"
  // Advanced past Service with lockout still selected → operator confirmed it.
  return step !== "SERVICE_SELECT" && step !== "BOOKING_COMPLETE"
}

/**
 * Resolve service id when Restore applies a draft — prefer CRM over false Lockout default.
 */
export function resolveRestoredDraftServiceTypeId(params: {
  draftServiceTypeId: string | null | undefined
  crmServiceTypeId?: ServiceQuoteTypeId | null
  notes?: string | null
  jobType?: string | null
  savedStep?: string | null
}): ServiceQuoteTypeId | "" {
  const draft = String(params.draftServiceTypeId ?? "").trim()
  const crm = params.crmServiceTypeId ?? null
  const clearlyLockout = draftClearlyChoseLockout(
    { serviceQuoteTypeId: draft, notes: params.notes, jobType: params.jobType },
    params.savedStep
  )
  // CRM known type wins over an autosaved Lockout default.
  if (crm && (draft === "" || draft === "lockout") && !clearlyLockout) {
    return crm
  }
  if (draft === "lockout" && !clearlyLockout) return ""
  if (draft && (SERVICE_QUOTE_TYPE_IDS as readonly string[]).includes(draft)) {
    return draft as ServiceQuoteTypeId
  }
  return (crm ?? "") as ServiceQuoteTypeId | ""
}

/**
 * After Restore draft: land on first incomplete step (Continue-quote spirit).
 * Prefer the later of saved vs computed incomplete so mid-flow drafts are not yanked backward.
 * Mid key/name steps Continue does not model stay put when service is known —
 * unless computed incomplete is further ahead (e.g. schedule already filled → Customer).
 */
export function resumeDraftIntakeStep(params: {
  serviceTypeId: ServiceQuoteTypeId | ""
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
  addressReady: boolean
  savedStep: string | null | undefined
  displayName?: string
  scheduledDate?: string
  scheduledTime?: string
}): DraftResumeStep {
  const incomplete = continueOpenQuoteStep({
    serviceTypeId: params.serviceTypeId,
    vehicleYear: params.vehicleYear,
    vehicleMake: params.vehicleMake,
    vehicleModel: params.vehicleModel,
    addressReady: params.addressReady,
    displayName: params.displayName,
    scheduledDate: params.scheduledDate,
    scheduledTime: params.scheduledTime,
  })
  const rawSaved = String(params.savedStep ?? "SERVICE_SELECT").trim() || "SERVICE_SELECT"
  const saved = rawSaved === "FINAL_DISPATCH" ? "SCHEDULE_TIME" : rawSaved
  if (saved === "BOOKING_COMPLETE") return incomplete

  const savedOrder = DRAFT_RESUME_STEP_ORDER[saved] ?? 0
  const incompleteOrder = DRAFT_RESUME_STEP_ORDER[incomplete] ?? 0

  // Old drafts could sit on Schedule before Customer — never skip a missing name.
  if (saved === "SCHEDULE_TIME" && incomplete === "CUSTOMER_NAME") {
    return "CUSTOMER_NAME"
  }

  // Mid key / name steps — keep when service is known, unless incomplete is further ahead.
  if (
    (saved === "JOB_TYPE" || saved === "KEY_SPECIFICS" || saved === "CUSTOMER_NAME") &&
    params.serviceTypeId
  ) {
    if (incompleteOrder > savedOrder) return incomplete
    return saved
  }

  // Prefer later of saved vs incomplete so mid-flow Address/Schedule is not yanked back.
  if (
    savedOrder > incompleteOrder &&
    (saved === "SERVICE_SELECT" ||
      saved === "VEHICLE_INFO" ||
      saved === "ADDRESS_CONTACT" ||
      saved === "SCHEDULE_TIME" ||
      saved === "CUSTOMER_NAME")
  ) {
    return saved as DraftResumeStep
  }
  return incomplete
}

/**
 * True when this phone should get the returning-caller decision card
 * (not a cold Service-first intake).
 *
 * Requires a real CRM bind and/or a meaningful pending draft for THIS E.164
 * (see isIntakeDraftMeaningful) — never a global/cross-caller draft.
 */
export function isKnownReturningCaller(params: {
  hasMatchedCustomer: boolean
  hasPendingDraft: boolean
  openLeadId: string | null | undefined
  garageVehicleCount: number
  activeJobId: string | null | undefined
}): boolean {
  return Boolean(
    params.hasMatchedCustomer ||
      params.hasPendingDraft ||
      String(params.openLeadId ?? "").trim() ||
      params.garageVehicleCount > 0 ||
      String(params.activeJobId ?? "").trim()
  )
}

/** Open lead/quote exists — price optional (Allen-class thin leads still Continue). */
export function hasContinueableOpenLead(openLeadId: string | null | undefined): boolean {
  return Boolean(String(openLeadId ?? "").trim())
}

/**
 * Strip clarification spam ("Confirmed…") and truncate for the decision card.
 * Returns null when nothing useful remains.
 */
export function summarizeReturningCallerNotes(
  notes: string | null | undefined,
  maxLen = 72
): { preview: string; hasMore: boolean } | null {
  const raw = String(notes ?? "").trim()
  if (!raw) return null
  const parts = raw
    .split(/\s*[·•|]\s*|\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const kept = parts.filter((p) => {
    const lower = p.toLowerCase()
    if (lower.startsWith("confirmed ")) return false
    if (lower.startsWith("customer confirmed ")) return false
    return true
  })
  const cleaned = (kept.length > 0 ? kept : parts).join(" · ").replace(/\s+/g, " ").trim()
  if (!cleaned) return null
  if (cleaned.length <= maxLen) return { preview: cleaned, hasMore: false }
  return { preview: `${cleaned.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`, hasMore: true }
}

/** Compact YMM line for the decision card (garage / lead / form). */
export function formatReturningCallerVehicleFact(params: {
  year?: string | null
  make?: string | null
  model?: string | null
}): string | null {
  const label = [params.year, params.make, params.model]
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(" ")
  return label || null
}

/** Garage / CRM vehicle chips used to fill missing lead YMM. */
export type GarageYmmSource = {
  year?: string | null
  make?: string | null
  model?: string | null
}

/**
 * Resolve YMM for Book / Continue — prefer lead collected, else garage head.
 * Keeps Quote→Book from restarting on a blank Service/Lockout vehicle step.
 */
export function resolveOpenQuoteYmm(params: {
  lead?: OpenQuotePrefillSource | null
  garage?: GarageYmmSource | null
}): { year: string; make: string; model: string } {
  const leadYear = String(params.lead?.vehicle_year ?? "").trim()
  const leadMake = String(params.lead?.vehicle_make ?? "").trim()
  const leadModel = String(params.lead?.vehicle_model ?? "").trim()
  if (leadYear || leadMake || leadModel) {
    return { year: leadYear, make: leadMake, model: leadModel }
  }
  return {
    year: String(params.garage?.year ?? "").trim(),
    make: String(params.garage?.make ?? "").trim(),
    model: String(params.garage?.model ?? "").trim(),
  }
}

/**
 * Pool-ready open quote: enough to schedule/assign in JobDetailDrawer.
 * Thin quote (missing vehicle or address) should Continue-intake instead.
 */
export function isOpenLeadPoolReady(params: {
  lead: OpenQuotePrefillSource & { has_job_address?: boolean | null }
  /** Customer profile street/city when lead collected has no job address. */
  customerAddressReady?: boolean
  garage?: GarageYmmSource | null
}): boolean {
  const serviceTypeId = serviceQuoteTypeIdFromCrmHistory(params.lead) ?? ""
  const ymm = resolveOpenQuoteYmm({ lead: params.lead, garage: params.garage })
  const addressReady = Boolean(params.lead.has_job_address) || Boolean(params.customerAddressReady)
  // Pool-ready once vehicle + address are done (next step is Customer or Schedule).
  const next = continueOpenQuoteStep({
    serviceTypeId,
    vehicleYear: ymm.year,
    vehicleMake: ymm.make,
    vehicleModel: ymm.model,
    addressReady,
  })
  return next === "CUSTOMER_NAME" || next === "SCHEDULE_TIME"
}
