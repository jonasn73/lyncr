/**
 * Match a CRM list row to a phone from Messages / deep links.
 * Last 10 digits only — same as inbox threads.
 */

/** Last 10 digits of a phone (empty when too short). */
export function crmPhoneMatchKey(phone: string): string {
  return String(phone || "").replace(/\D/g, "").slice(-10)
}

/** True when CRM search is a phone (Messages deep-link), not a name. */
export function looksLikePhoneQuery(q: string): boolean {
  return crmPhoneMatchKey(q).length >= 10
}

/** Open this customer’s card (not a search list) when ?phone= matches a row. */
export function pickCrmCustomerIdForPhone(
  rows: ReadonlyArray<{ id: string; phone_e164?: string | null }>,
  phone: string
): string | null {
  const key = crmPhoneMatchKey(phone)
  if (key.length < 10) return null
  const match = rows.find((row) => crmPhoneMatchKey(String(row.phone_e164 || "")) === key)
  return match?.id ?? null
}
