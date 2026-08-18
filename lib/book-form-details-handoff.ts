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

/** Newest leftover book form for this phone (not only the last Lines tap). */
export function findLatestBookFormForPhone(
  items: ReadonlyArray<LatestCustomerAction>,
  phone: string
): LatestCustomerAction | null {
  const key = phoneKey(phone)
  if (key.length < 10) return null
  const matches = items.filter(
    (row) => row.event === "book_form" && phoneKey(row.customerPhone) === key
  )
  if (matches.length === 0) return null
  return matches.reduce((newest, row) =>
    new Date(row.at).getTime() > new Date(newest.at).getTime() ? row : newest
  )
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

/**
 * Open the existing Booking request sheet over the current tab (Messages or Lines).
 * Pass the book-form row when we have it so we do not depend on a prior Lines tap.
 */
export function requestReopenBookFormDetail(item?: LatestCustomerAction | null): void {
  if (typeof window === "undefined") return
  const next = item?.event === "book_form" ? item : peekBookFormDetailsHandoff()
  if (!next || next.event !== "book_form") return
  writeBookFormDetailsHandoff(next)
  try {
    sessionStorage.setItem(BOOK_FORM_REOPEN_PENDING_KEY, "1")
  } catch {
    // ignore quota / private mode
  }
  try {
    window.dispatchEvent(
      new CustomEvent(LYNCR_REOPEN_BOOK_FORM_DETAIL_EVENT, { detail: next })
    )
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
