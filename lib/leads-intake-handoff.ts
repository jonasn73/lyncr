/** Pass CRM lead context into the scheduler intake sheet after "Convert to Active Booking". */

export const LEADS_INTAKE_HANDOFF_KEY = "lyncr_leads_intake_handoff"

export type LeadsIntakeHandoff = {
  leadId: string
  phoneNumber: string
  customerName: string
  vehicleYear?: string
  vehicleMake?: string
  vehicleModel?: string
  quotedPriceCents?: number
}

export function writeLeadsIntakeHandoff(payload: LeadsIntakeHandoff): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(LEADS_INTAKE_HANDOFF_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota / private mode
  }
}

export function readAndClearLeadsIntakeHandoff(): LeadsIntakeHandoff | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(LEADS_INTAKE_HANDOFF_KEY)
    sessionStorage.removeItem(LEADS_INTAKE_HANDOFF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LeadsIntakeHandoff
    if (!parsed?.leadId?.trim()) return null
    return {
      leadId: parsed.leadId.trim(),
      phoneNumber: String(parsed.phoneNumber ?? "").trim(),
      customerName: String(parsed.customerName ?? "").trim(),
      vehicleYear: parsed.vehicleYear?.trim() || undefined,
      vehicleMake: parsed.vehicleMake?.trim() || undefined,
      vehicleModel: parsed.vehicleModel?.trim() || undefined,
      quotedPriceCents:
        typeof parsed.quotedPriceCents === "number" && parsed.quotedPriceCents > 0
          ? Math.round(parsed.quotedPriceCents)
          : undefined,
    }
  } catch {
    return null
  }
}
