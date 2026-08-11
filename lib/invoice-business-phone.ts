// Customer-facing phone on invoices: business DID (main line), never owner cell.

import {
  getOnboardingProfile,
  getPhoneNumbers,
  getUser,
  listCompletedPortPhoneNumbersForOwner,
} from "@/lib/db"
import { isDashboardVisibleLineStatus } from "@/lib/dashboard-routing-utils"
import { filterInboundBusinessLines } from "@/lib/owner-cell-line-filter"
import { pickPreferredCustomerLine } from "@/lib/preferred-business-line"

/**
 * Primary business line for invoice / receipt headers (page, PDF, email, SMS).
 * Prefers phone_numbers main DID; falls back to owner cell only if no line exists.
 */
export async function resolveInvoiceBusinessPhone(
  ownerUserId: string
): Promise<string | null> {
  const userId = ownerUserId.trim()
  if (!userId) return null

  const [user, numbers, profile, completedPortTargets] = await Promise.all([
    getUser(userId),
    getPhoneNumbers(userId),
    getOnboardingProfile(userId),
    listCompletedPortPhoneNumbersForOwner(userId),
  ])

  const ownerPhone = (user?.phone || "").trim() || null
  const visible = filterInboundBusinessLines(
    numbers.filter((n) => isDashboardVisibleLineStatus(n.status)),
    ownerPhone
  )
  const preferred = pickPreferredCustomerLine({
    lines: visible,
    reservedNumber: profile?.reserved_number ?? null,
    completedPortTargets,
  })
  if (preferred?.trim()) return preferred.trim()

  return ownerPhone
}
