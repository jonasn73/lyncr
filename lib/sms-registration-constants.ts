// Shared SMS registration form constants (safe for client components).

import type { TenDlcEntityType } from "@/lib/types"

export const SMS_ENTITY_TYPE_OPTIONS = [
  { value: "LLC", label: "LLC" },
  { value: "Sole Proprietorship", label: "Sole Proprietorship" },
  { value: "Corporation", label: "Corporation" },
  { value: "Partnership", label: "Partnership" },
  { value: "Non-Profit", label: "Non-Profit" },
] as const

export type SmsRegistrationFormInput = {
  organization_id?: string | null
  legal_business_name: string
  entity_type: string
  tax_id_ein?: string
  street: string
  city: string
  state: string
  postal_code: string
  use_case_description: string
}

export function mapEntityTypeToTenDlc(entityType: string): TenDlcEntityType {
  const key = entityType.trim().toLowerCase()
  if (key.includes("sole")) return "SOLE_PROPRIETOR"
  if (key.includes("non")) return "NON_PROFIT"
  return "PRIVATE_PROFIT"
}

function requiresEin(entityType: string): boolean {
  return !entityType.trim().toLowerCase().includes("sole")
}

export function validateSmsRegistrationInput(input: SmsRegistrationFormInput): string | null {
  if (!input.legal_business_name.trim()) return "Legal business name is required."
  if (!input.entity_type.trim()) return "Choose a business entity type."
  if (!input.street.trim() || !input.city.trim() || !input.state.trim() || !input.postal_code.trim()) {
    return "Complete your business address (street, city, state, ZIP)."
  }
  if (!input.use_case_description.trim()) return "Describe how your business uses SMS."
  if (requiresEin(input.entity_type)) {
    const ein = (input.tax_id_ein ?? "").replace(/\D/g, "")
    if (ein.length !== 9) return "A 9-digit Tax ID / EIN is required for this entity type."
  }
  return null
}

export function requiresSmsRegistrationEin(entityType: string): boolean {
  return requiresEin(entityType)
}
