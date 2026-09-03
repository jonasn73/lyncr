/** True when value looks like a Postgres UUID (raw id leaked into UI). */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
}

/** Opaque backend ids (uuid, cuid, nanoid) that must never appear in the UI. */
function looksLikeOpaqueId(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (isUuid(v)) return true
  if (/^[a-z0-9_-]{20,}$/i.test(v) && digitsOnly(v).length < 10) return true
  return false
}

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "")
}

function normalizeE164(phone: string): string {
  const d = digitsOnly(phone)
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith("1")) return `+${d}`
  if (phone.startsWith("+")) return phone
  return phone
}

export function formatPhoneDisplay(phone: string | undefined | null): string {
  const v = String(phone || "")
  if (!v) return "Unknown"
  const digits = digitsOnly(v)
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return v
}

/** Short display when we have digits but no friendly label (e.g. unmapped line). */
function truncatePhoneLabel(phone: string | undefined | null): string {
  const digits = digitsOnly(String(phone || ""))
  if (digits.length >= 10) {
    const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
    return `···${d.slice(-4)}`
  }
  return "Unknown Line"
}

export type LineLabelEntry = { number: string; label: string }

/** Map E.164 (+ variants) → display label from owned business numbers. */
export function buildBusinessLineLabelMap(numbers: LineLabelEntry[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of numbers) {
    const num = row.number?.trim()
    if (!num) continue
    const label = row.label?.trim() || "Business Line"
    map.set(num, label)
    map.set(normalizeE164(num), label)
    const d = digitsOnly(num)
    if (d.length >= 10) map.set(d, label)
  }
  return map
}

export function resolveBusinessLineLabel(
  toNumber: string | null | undefined,
  labelMap: Map<string, string>
): string {
  const raw = String(toNumber ?? "").trim()
  if (!raw) return "Unknown Line"
  if (looksLikeOpaqueId(raw)) return "Unknown Line"

  const fromMap =
    labelMap.get(raw) ??
    labelMap.get(normalizeE164(raw)) ??
    labelMap.get(digitsOnly(raw))
  if (fromMap) return fromMap

  const digitLen = digitsOnly(raw).length
  if (raw.startsWith("+") || digitLen >= 10) return formatPhoneDisplay(raw)
  if (digitLen >= 4) return truncatePhoneLabel(raw)

  return "Unknown Line"
}
