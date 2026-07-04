// Transparent baseline locksmith pricing for the answered-call quick-booking sheet.

import { formatIntakeJobTypeForDispatch, type IntakeLocksmithJobType } from "@/lib/intake-job-types"

/** Service types shown in the quote calculator (maps to intake job types). */
export const SERVICE_QUOTE_TYPES = [
  { id: "lockout", label: "Lockout", jobType: "Lockout" as IntakeLocksmithJobType, keyMode: "" },
  { id: "key_gen", label: "Key Generation", jobType: "Key replacement" as IntakeLocksmithJobType, keyMode: "Origination" },
  { id: "key_dup", label: "Key Duplication", jobType: "Key replacement" as IntakeLocksmithJobType, keyMode: "Duplication" },
  { id: "ignition", label: "Ignition Repair", jobType: "Ignition" as IntakeLocksmithJobType, keyMode: "" },
  { id: "other", label: "Other Service", jobType: "Other" as IntakeLocksmithJobType, keyMode: "" },
] as const

export type ServiceQuoteTypeId = (typeof SERVICE_QUOTE_TYPES)[number]["id"]

const BASE_CENTS: Record<ServiceQuoteTypeId, number> = {
  lockout: 8500,
  key_gen: 17500,
  key_dup: 9500,
  ignition: 22000,
  other: 12000,
}

const LUXURY_MAKES = new Set(
  [
    "Acura",
    "Audi",
    "BMW",
    "Cadillac",
    "Genesis",
    "Infiniti",
    "Jaguar",
    "Land Rover",
    "Lexus",
    "Lincoln",
    "Mercedes-Benz",
    "Mercedes",
    "Porsche",
    "Tesla",
    "Volvo",
  ].map((m) => m.toLowerCase())
)

export type ServiceQuoteBreakdownLine = {
  label: string
  cents: number
}

export type ServiceQuoteResult = {
  serviceTypeId: ServiceQuoteTypeId
  jobType: IntakeLocksmithJobType
  keyReplacementMode: string
  dispatchJobTypeLabel: string
  totalCents: number
  lines: ServiceQuoteBreakdownLine[]
}

function yearSurchargeCents(year: string): number {
  const y = Number.parseInt(year, 10)
  if (!Number.isFinite(y)) return 0
  const age = new Date().getFullYear() - y
  if (age >= 20) return 3500
  if (age >= 12) return 1500
  return 0
}

function makeSurchargeCents(make: string): number {
  const key = make.trim().toLowerCase()
  if (!key) return 0
  return LUXURY_MAKES.has(key) ? 2500 : 0
}

/** Resolve a quote type id from intake job type + key mode strings. */
export function serviceQuoteTypeIdFromIntake(jobType: string, keyMode: string): ServiceQuoteTypeId {
  if (jobType === "Lockout") return "lockout"
  if (jobType === "Ignition") return "ignition"
  if (jobType === "Key replacement") {
    return keyMode === "Duplication" ? "key_dup" : "key_gen"
  }
  return "other"
}

/** Compute a live baseline quote from YMM + service selection. */
export function calculateServiceQuote(params: {
  serviceTypeId: ServiceQuoteTypeId
  vehicleYear?: string
  vehicleMake?: string
  vehicleModel?: string
}): ServiceQuoteResult {
  const spec = SERVICE_QUOTE_TYPES.find((s) => s.id === params.serviceTypeId) ?? SERVICE_QUOTE_TYPES[0]
  const base = BASE_CENTS[spec.id]
  const yearExtra = yearSurchargeCents(params.vehicleYear ?? "")
  const makeExtra = makeSurchargeCents(params.vehicleMake ?? "")

  const lines: ServiceQuoteBreakdownLine[] = [{ label: `${spec.label} base`, cents: base }]
  if (yearExtra > 0) lines.push({ label: "Vehicle age adjustment", cents: yearExtra })
  if (makeExtra > 0) lines.push({ label: "Premium make adjustment", cents: makeExtra })

  const totalCents = base + yearExtra + makeExtra

  return {
    serviceTypeId: spec.id,
    jobType: spec.jobType,
    keyReplacementMode: spec.keyMode,
    dispatchJobTypeLabel: formatIntakeJobTypeForDispatch(spec.jobType, spec.keyMode),
    totalCents,
    lines,
  }
}

export function formatQuoteDollars(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`
}
