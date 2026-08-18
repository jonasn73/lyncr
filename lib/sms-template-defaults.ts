/**
 * Stock SMS copy — human, no fake slots or ETAs.
 * If a shop still has an old built-in sentence saved, treat it as “use the new default.”
 */

export const DEFAULT_SMS_PHASE_TEMPLATES = {
  booking:
    "Hey {{customer_name}} — we got your request for the {{vehicle}}. We’ll follow up here. Text us here for any update or change. — {{business_name}}",
  route:
    "Hey {{customer_name}} — I’m on my way. Text us here for any update or change. — {{business_name}}",
  review:
    "Hey {{customer_name}} — thanks for choosing {{business_name}}. If you have a minute, a quick review helps a lot: {{review_url}}",
} as const

/** Older product defaults we replace in the editor (custom shop copy is left alone). */
export const LEGACY_SMS_PHASE_TEMPLATES = {
  booking: [
    "Hi {{customer_name}}, this is {{business_name}}. Your request is in for {{time_slot}}. We'll confirm shortly. Reply here if anything changes.",
    "Hey {{customer_name}} — we got your request. We’ll follow up here. Text us here for any update or change. — {{business_name}}",
  ],
  route: [
    "Hi {{customer_name}}, your {{business_name}} technician {{tech_name}} is on the way. See you soon!",
  ],
  review: [
    "Thanks for choosing {{business_name}}, {{customer_name}}! Leave us a quick review: {{review_url}}",
    "Thanks for choosing {{business_name}}, {{customer_name}}! We'd love your feedback — leave a quick review: {{review_url}}",
  ],
} as const

/** Use current stock copy when nothing is saved, or the saved text is an old built-in. */
export function stockOrSaved(
  saved: string | null | undefined,
  current: string,
  legacy: readonly string[]
): string {
  const t = typeof saved === "string" ? saved.trim() : ""
  if (!t) return current
  const normalized = t.replace(/\s+/g, " ")
  if (legacy.some((old) => old.replace(/\s+/g, " ").trim() === normalized)) return current
  return t
}

/** Fill {{tag}} tokens. Unknown tags become empty. */
export function renderSmsTemplate(template: string, vars: Record<string, string>): string {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) lower[k.toLowerCase()] = v
  return template
    .replace(/\{\{\s*([\w]+)\s*\}\}/g, (_m, key: string) => lower[key.toLowerCase()] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim()
}

/** Drop “for the {{vehicle}}” when we don’t know the vehicle or job. */
export function withOptionalVehicleTemplate(template: string, vehicle: string): string {
  if (vehicle.trim()) return template
  return template
    .replace(/\s+for the \{\{\s*vehicle\s*\}\}/gi, "")
    .replace(/\s+for \{\{\s*vehicle\s*\}\}/gi, "")
}
