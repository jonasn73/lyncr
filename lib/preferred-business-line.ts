// Pick the customer-facing business DID — ported main lines beat temporary placeholder DIDs.

import {
  businessNumbersMatch,
  isDashboardVisibleLineStatus,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import { isPhoneNumberCarrierLive } from "@/lib/onboarding-line-carrier-status"
import type { PhoneNumber } from "@/lib/types"

/** Minimal row shape for line ranking (dashboard + DB). */
export type PreferredLineCandidate = Pick<
  PhoneNumber | DashboardBusinessNumber,
  "number" | "status" | "label"
> &
  Partial<Pick<PhoneNumber, "provider_number_sid" | "twilio_sid">>

export type PickPreferredCustomerLineInput = {
  lines: PreferredLineCandidate[]
  /** E.164 targets from completed port orders, newest first. */
  completedPortTargets?: string[]
  /** Onboarding / workspace reserved DID (intended main line). */
  reservedNumber?: string | null
  /** Current UI selection — kept when still valid unless a completed port should win. */
  previousSelection?: string | null
}

function isCarrierLiveRow(row: PreferredLineCandidate): boolean {
  return isPhoneNumberCarrierLive({
    provider_number_sid: row.provider_number_sid ?? null,
    status: row.status,
  })
}

function findVisible(
  lines: PreferredLineCandidate[],
  e164: string | null | undefined
): PreferredLineCandidate | undefined {
  if (!e164?.trim()) return undefined
  return lines.find((line) => businessNumbersMatch(line.number, e164))
}

/**
 * Rank business lines so the ported customer number wins over a temp DID bought during onboarding.
 */
export function pickPreferredCustomerLine(input: PickPreferredCustomerLineInput): string | null {
  const visible = input.lines.filter((line) => isDashboardVisibleLineStatus(line.status))
  if (visible.length === 0) return null

  // Completed port targets that are active on the carrier are the intended public number.
  for (const target of input.completedPortTargets ?? []) {
    const row = findVisible(visible, target)
    if (row?.status === "active" && isCarrierLiveRow(row)) return row.number
  }

  // Onboarding reserved_number after promotion (set when a port completes).
  const reserved = findVisible(visible, input.reservedNumber)
  if (reserved?.status === "active" && isCarrierLiveRow(reserved)) return reserved.number

  // Still porting but reserved — surface it while temp lines stay secondary.
  if (reserved && (reserved.status === "porting" || reserved.status === "pending")) {
    return reserved.number
  }

  // Completed port active even if provider sid not synced yet.
  for (const target of input.completedPortTargets ?? []) {
    const row = findVisible(visible, target)
    if (row?.status === "active") return row.number
  }

  if (
    input.previousSelection &&
    visible.some((line) => businessNumbersMatch(line.number, input.previousSelection))
  ) {
    return input.previousSelection
  }

  const live = visible.find((line) => line.status === "active" && isCarrierLiveRow(line))
  if (live) return live.number

  return visible[0]?.number ?? null
}

/** Sort lines for sidebar / picker — preferred customer line first. */
export function sortBusinessLinesForDisplay(
  lines: PreferredLineCandidate[],
  preferred: string | null | undefined
): PreferredLineCandidate[] {
  if (!preferred?.trim()) return [...lines]
  const idx = lines.findIndex((line) => businessNumbersMatch(line.number, preferred))
  if (idx <= 0) return [...lines]
  const copy = [...lines]
  const [row] = copy.splice(idx, 1)
  copy.unshift(row)
  return copy
}
