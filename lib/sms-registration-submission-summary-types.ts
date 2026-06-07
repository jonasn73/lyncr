// Client-safe types + formatters for 10DLC submission summary UI.

export type SmsRegistrationLifecycleStage = "submitted" | "carrier_review" | "approved" | "rejected"

export type SmsRegistrationSubmissionSummary = {
  legal_business_name: string | null
  entity_type: string | null
  business_address: string | null
  use_case_description: string | null
  target_phone_line: string | null
  target_line_label: string | null
  submission_date: string | null
  carrier_reference_id: string | null
  carrier_reference_kind: "campaign" | "brand" | null
  registration_status: string | null
  organization_status: string | null
  telnyx_status: string | null
  status_detail: string | null
  lifecycle_stage: SmsRegistrationLifecycleStage
  rejection_reason: string | null
}

export function formatSmsSubmissionDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
