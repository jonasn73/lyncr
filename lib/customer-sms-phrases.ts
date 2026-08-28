// How a customer text names the job and the vehicle.
//
// These lived in the Amber coworker module, but nothing about them is Amber: the intake
// booking SMS, the "got it" holding text, the reply suggestions and the Messages composer
// all build customer copy with them. They outlived the feature they were filed under.

import {
  DEFAULT_SMS_PHASE_TEMPLATES,
  LEGACY_SMS_PHASE_TEMPLATES,
  renderSmsTemplate,
  stockOrSaved,
  withOptionalVehicleTemplate,
} from "@/lib/sms-template-defaults"

/** Join year/make/model for customer SMS (empty when we have none). */
export function formatVehicleForSms(params: {
  year?: string | null
  make?: string | null
  model?: string | null
}): string {
  return [params.year, params.make, params.model]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ")
}

/**
 * How we name the job in a customer text: vehicle + “key” when it’s a key job.
 * Never ASAP, never their window, never shop codes like (AKL).
 */
export function formatCustomerNeedPhrase(params: {
  vehicle?: string | null
  jobLabel?: string | null
}): string {
  const vehicle = String(params.vehicle || "").trim()
  const rawJob = String(params.jobLabel || "").trim()
  const job = rawJob.replace(/\s*\([^)]*\)/g, "").trim()
  const keyJob = /\b(key|keys|akl|lockout|ignition|fob)\b/i.test(`${rawJob} ${job}`)
  if (vehicle && keyJob) return `${vehicle} key`
  if (vehicle) return vehicle
  if (job) return job
  return ""
}

/** Holding SMS — human recap. No ASAP, no window, no street, no ETAs/prices. */
export function buildGotItHoldingCustomerSms(params: {
  customerFirstName: string
  businessName: string
  jobLabel?: string | null
  vehicle?: string | null
  urgency?: string | null
  availabilityLabel?: string | null
  addressSnippet?: string | null
  /** Owner Follow-up template from SMS templates. Empty uses stock copy. */
  template?: string | null
}): string {
  const who = params.customerFirstName || "there"
  const biz = String(params.businessName || "").trim() || "us"
  const need = formatCustomerNeedPhrase({
    vehicle: params.vehicle,
    jobLabel: params.jobLabel,
  })
  const template = stockOrSaved(
    params.template,
    DEFAULT_SMS_PHASE_TEMPLATES.booking,
    LEGACY_SMS_PHASE_TEMPLATES.booking
  )
  const filled = withOptionalVehicleTemplate(template, need)
  return renderSmsTemplate(filled, {
    customer_name: who,
    business_name: biz,
    vehicle: need,
  })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320)
}

/** First name for a customer text, falling back to a friendly "there". */
export function customerFirstName(fullName: string | null | undefined): string {
  const first = String(fullName ?? "")
    .trim()
    .split(/\s+/)[0]
  return first || "there"
}
