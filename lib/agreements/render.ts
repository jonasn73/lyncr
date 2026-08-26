// ============================================
// Rendering an agreement, and fingerprinting what was rendered
// ============================================
// Interpolation is deliberately strict: an unresolved {{placeholder}} throws rather
// than rendering literally. An agreement that reaches a worker saying "{{pay_summary}}"
// is not one anyone can be asked to sign, and it would be fingerprinted and frozen in
// that state.

import { createHash } from "crypto"
import { describePayPlan, type EmploymentType, type PayComponent } from "@/lib/compensation/plan-schema"
import { defaultTemplate, templateKindForEmployment, type AgreementKind } from "@/lib/agreements/templates"

export interface AgreementRenderInput {
  businessName: string
  workerName: string
  workerRole: "receptionist" | "field_tech"
  employmentType: EmploymentType
  components: PayComponent[]
  /** When the terms take effect. ISO date; rendered long-form. */
  startDateIso: string
  /** PAY_ADDENDUM only — what the addendum is amending. */
  agreementLabel?: string
}

export interface RenderedAgreement {
  kind: AgreementKind
  title: string
  templateVersion: number
  body: string
  sha256: string
  paySummary: string
}

function longDate(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return "the date you sign"
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}

function roleLabel(role: "receptionist" | "field_tech"): string {
  return role === "receptionist" ? "a receptionist" : "a field technician"
}

/**
 * The sentence about the wage floor, or nothing.
 *
 * Only W-2 plans carry a floor, and only when the owner actually attached one. Saying
 * "you are guaranteed minimum wage" in a contract that has no such term would be a
 * promise the system does not keep.
 */
function wageFloorClause(components: PayComponent[], employmentType: EmploymentType): string {
  if (employmentType !== "W2_EMPLOYEE") return ""
  const floor = components.find((c) => c.kind === "MINIMUM_WAGE_TOPUP")
  if (!floor || floor.kind !== "MINIMUM_WAGE_TOPUP") return ""
  const hourly = (floor.hourly_floor_micros / 1_000_000).toFixed(2)
  return `\nIf your pay for any workweek works out to less than $${hourly} per hour for the hours you worked that week, the Company will pay you the difference. This is calculated for each workweek on its own.\n`
}

/** How hours are recorded, in language that matches how the plan actually pays. */
function hoursClause(components: PayComponent[]): string {
  const onShift = components.some((c) => c.kind === "TIME" && c.basis === "ON_SHIFT")
  if (onShift) {
    return "You go on and off duty in the app, and that is what records your hours. Go on duty when you start and off duty when you finish."
  }
  return "You go on and off duty in the app. Even where your pay is not calculated from hours, this record is what shows how long you worked."
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g

/** Substitute every placeholder, or throw naming the one that had no value. */
function interpolate(body: string, values: Record<string, string>): string {
  const missing: string[] = []
  const out = body.replace(PLACEHOLDER, (_match, key: string) => {
    const value = values[key]
    if (value === undefined) {
      missing.push(key)
      return ""
    }
    return value
  })
  if (missing.length > 0) {
    throw new Error(`Agreement is missing values for: ${missing.join(", ")}`)
  }
  // Collapse the blank-line runs an empty optional clause leaves behind.
  return out.replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Render an agreement and fingerprint it.
 *
 * The returned body is what gets stored and shown; the hash is what proves, later,
 * which words were agreed to even if the template has since changed.
 */
export function renderAgreement(
  input: AgreementRenderInput,
  kind?: AgreementKind
): RenderedAgreement {
  if (input.employmentType === "UNSPECIFIED") {
    throw new Error("Set the worker's employment type before sending an agreement.")
  }
  if (input.components.length === 0) {
    throw new Error("Set the worker's pay before sending an agreement.")
  }

  const resolvedKind = kind ?? templateKindForEmployment(input.employmentType)
  const template = defaultTemplate(resolvedKind)
  const paySummary = describePayPlan(input.components)

  const body = interpolate(template.body_md, {
    business_name: input.businessName.trim() || "The Company",
    worker_name: input.workerName.trim(),
    role_label: roleLabel(input.workerRole),
    start_date: longDate(input.startDateIso),
    // Capitalized and closed as its own sentence — describePayPlan returns a fragment.
    pay_summary: `You will be paid ${paySummary}.`,
    wage_floor_clause: wageFloorClause(input.components, input.employmentType),
    hours_clause: hoursClause(input.components),
    agreement_label: input.agreementLabel ?? "agreement",
  })

  return {
    kind: resolvedKind,
    title: template.title,
    templateVersion: template.version,
    body,
    sha256: hashAgreementBody(body),
    paySummary,
  }
}

/** Fingerprint an agreement body. */
export function hashAgreementBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex")
}

/** True when stored text still matches the fingerprint taken at signing. */
export function agreementBodyMatches(body: string, sha256: string): boolean {
  return hashAgreementBody(body) === sha256
}
