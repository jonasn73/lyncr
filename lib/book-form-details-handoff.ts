// Stash a book-from-hold / book-form Latest row so Messages can link back
// to the booking-details sheet (SMS alone does not show submitted fields).

import type { LatestCustomerAction } from "@/lib/latest-customer-actions"

/** sessionStorage key for the last book-form alert the owner opened. */
export const BOOK_FORM_DETAILS_HANDOFF_KEY = "lyncr_book_form_details_handoff"

/** Flag: Lines should reopen the booking sheet after navigating from Messages. */
export const BOOK_FORM_REOPEN_PENDING_KEY = "lyncr_book_form_reopen_pending"

/** Same-tab signal when Lines is already mounted (hidden under Messages). */
export const LYNCR_REOPEN_BOOK_FORM_DETAIL_EVENT = "lyncr:reopen-book-form-detail"

/** Last 10 digits — matches Latest / Messages phone keys. */
function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10)
}

/** Persist the book-form row for “View booking details” from Messages. */
export function writeBookFormDetailsHandoff(item: LatestCustomerAction): void {
  if (typeof window === "undefined") return
  if (item.event !== "book_form") return
  try {
    sessionStorage.setItem(BOOK_FORM_DETAILS_HANDOFF_KEY, JSON.stringify(item))
  } catch {
    // ignore quota / private mode
  }
}

/** Read the stashed row without clearing (banner peek). */
export function peekBookFormDetailsHandoff(): LatestCustomerAction | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(BOOK_FORM_DETAILS_HANDOFF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LatestCustomerAction
    if (!parsed || parsed.event !== "book_form") return null
    return parsed
  } catch {
    return null
  }
}

/** True when Messages should offer a way back to this phone’s booking sheet. */
export function bookFormHandoffMatchesPhone(phone: string): boolean {
  const item = peekBookFormDetailsHandoff()
  if (!item?.customerPhone) return false
  const a = phoneKey(phone)
  const b = phoneKey(item.customerPhone)
  return a.length >= 10 && a === b
}

/** Drop the stash (Schedule job / done viewing). */
export function clearBookFormDetailsHandoff(): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(BOOK_FORM_DETAILS_HANDOFF_KEY)
    sessionStorage.removeItem(BOOK_FORM_REOPEN_PENDING_KEY)
  } catch {
    // ignore
  }
}

/** Messages → Lines: mark pending reopen and notify a mounted Alerts card. */
export function requestReopenBookFormDetail(): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(BOOK_FORM_REOPEN_PENDING_KEY, "1")
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent(LYNCR_REOPEN_BOOK_FORM_DETAIL_EVENT))
  } catch {
    // ignore
  }
}

/** Consume the pending-reopen flag (returns true once per request). */
export function consumeBookFormReopenPending(): boolean {
  if (typeof window === "undefined") return false
  try {
    const raw = sessionStorage.getItem(BOOK_FORM_REOPEN_PENDING_KEY)
    if (raw !== "1") return false
    sessionStorage.removeItem(BOOK_FORM_REOPEN_PENDING_KEY)
    return true
  } catch {
    return false
  }
}
