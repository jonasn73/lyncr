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
  /** Customer-facing brand / DBA shown in SMS (defaults to legal name). */
  display_name?: string
  /** Brand website required by carriers for KYC (not lyncr.app). */
  website?: string
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

function normalizeWebsiteUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (!url.hostname.includes(".")) return null
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

/** Reject platform / agency domains — carriers require the end brand's site (error 710). */
export function isAgencyWebsiteHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^www\./, "")
  return (
    host === "lyncr.app" ||
    host.endsWith(".lyncr.app") ||
    host === "getzingapp.com" ||
    host.endsWith(".getzingapp.com") ||
    host === "telnyx.com" ||
    host.endsWith(".telnyx.com")
  )
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
  const website = normalizeWebsiteUrl(input.website ?? "")
  if (!website) {
    return "Add your business website (the brand customers know — not lyncr.app)."
  }
  try {
    const host = new URL(website).hostname
    if (isAgencyWebsiteHost(host)) {
      return "Use your own business website URL. Carriers reject lyncr.app / agency sites (error 710)."
    }
  } catch {
    return "Enter a valid business website URL (example: https://keysquad502.com)."
  }
  return null
}

export function requiresSmsRegistrationEin(entityType: string): boolean {
  return requiresEin(entityType)
}

export function normalizeSmsRegistrationWebsite(raw: string | null | undefined): string | null {
  return normalizeWebsiteUrl(String(raw ?? ""))
}

/** Brand-specific public opt-in URL carriers can screenshot for KYC. */
export function buildBrandSmsOptInUrl(displayName: string, website?: string | null): string {
  const params = new URLSearchParams()
  const brand = displayName.trim()
  if (brand) params.set("brand", brand)
  const site = normalizeWebsiteUrl(website ?? "")
  if (site) params.set("website", site)
  const qs = params.toString()
  return `https://lyncr.app/sms-opt-in${qs ? `?${qs}` : ""}`
}
