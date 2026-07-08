// Shared helpers for answered-call intake phone fields.

/** Prefer the typed phone, then fall back to the active call's caller ID. */
export function resolveIntakePhone(formPhone: string, callFromNumber?: string | null): string {
  return (formPhone.trim() || callFromNumber?.trim() || "").trim()
}

/** True when the string has at least 10 dialable digits (US + international tolerant). */
export function hasCompleteIntakePhone(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 10
}
