// Pick the intended primary business DID for a workspace — port-in lines beat temporary active lines.

import { getPhoneNumbers, listPortingOrdersForOwner, normalizePhoneNumberE164 } from "@/lib/db"
import type { PhoneNumber, PortingOrder } from "@/lib/types"

export type ResolvedPrimaryLine = {
  number: string | null
  label: string | null
  /** True when the line exists but is not yet active on the carrier (port still in flight). */
  awaiting_port: boolean
}

function isOpenPortOrder(order: PortingOrder): boolean {
  return order.status === "pending" || order.status === "processing"
}

function lineLabel(row: PhoneNumber, fallback: string): string {
  return row.label?.trim() || row.friendly_name?.trim() || fallback
}

/**
 * Resolve which E.164 is the main business line for SMS display / 10DLC assignment.
 * When a number transfer is in progress, that port target wins over other active lines
 * (e.g. a temporary DID or a personal cell mistakenly listed as a business line).
 */
export async function resolvePrimaryBusinessLineForOrganization(
  ownerUserId: string,
  organizationId: string | null,
  assignedNumber?: string | null
): Promise<ResolvedPrimaryLine> {
  if (assignedNumber?.trim()) {
    const assigned = normalizePhoneNumberE164(assignedNumber)
    const portOrders = await listPortingOrdersForOwner(ownerUserId, organizationId)
    const openPort = portOrders.find(isOpenPortOrder)
    if (openPort?.phone_number?.trim()) {
      const portE164 = normalizePhoneNumberE164(openPort.phone_number)
      if (portE164 && portE164 !== assigned) {
        // Stale assignment (e.g. temp line) — show the in-flight port as the intended main line.
      } else {
        return { number: assigned, label: null, awaiting_port: false }
      }
    } else {
      return { number: assigned, label: null, awaiting_port: false }
    }
  }

  if (!organizationId || organizationId.startsWith("legacy-")) {
    return { number: null, label: null, awaiting_port: false }
  }

  const [numbers, portOrders] = await Promise.all([
    getPhoneNumbers(ownerUserId, organizationId),
    listPortingOrdersForOwner(ownerUserId, organizationId),
  ])

  const openPort = portOrders.find(isOpenPortOrder)
  if (openPort?.phone_number?.trim()) {
    const portE164 = normalizePhoneNumberE164(openPort.phone_number)
    const portRow = numbers.find((n) => normalizePhoneNumberE164(n.number) === portE164)
    return {
      number: portE164,
      label: portRow ? lineLabel(portRow, "Port in progress") : "Number transfer in progress",
      awaiting_port: portRow?.status !== "active",
    }
  }

  const portingRow = numbers.find((n) => n.status === "porting")
  if (portingRow?.number?.trim()) {
    return {
      number: normalizePhoneNumberE164(portingRow.number),
      label: lineLabel(portingRow, "Port in progress"),
      awaiting_port: true,
    }
  }

  const completedPortTargets = portOrders
    .filter((o) => o.status === "completed" && o.phone_number?.trim())
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map((o) => normalizePhoneNumberE164(o.phone_number))

  for (const portE164 of completedPortTargets) {
    const portRow = numbers.find((n) => normalizePhoneNumberE164(n.number) === portE164)
    if (portRow?.status === "active") {
      return {
        number: portE164,
        label: lineLabel(portRow, "Business line"),
        awaiting_port: false,
      }
    }
  }

  const active = numbers.find(
    (n) =>
      n.status === "active" &&
      Boolean(n.provider_number_sid?.trim() || n.twilio_sid?.trim())
  )
  if (active?.number?.trim()) {
    return {
      number: normalizePhoneNumberE164(active.number),
      label: lineLabel(active, "Business line"),
      awaiting_port: false,
    }
  }

  if (numbers[0]?.number?.trim()) {
    return {
      number: normalizePhoneNumberE164(numbers[0].number),
      label: lineLabel(numbers[0], "Business line"),
      awaiting_port: numbers[0].status === "porting",
    }
  }

  return { number: null, label: null, awaiting_port: false }
}

/**
 * E.164 to attach to an approved 10DLC campaign — only returns a carrier-live active DID.
 * Waits for an in-flight port instead of attaching SMS to a temporary line.
 */
export async function resolveActiveLineFor10DlcAssignment(
  ownerUserId: string,
  organizationId?: string | null
): Promise<string | null> {
  // Prefer a DID that still exists on Telnyx (skips released/stale Neon rows).
  const { isTelnyxOwnedNumber } = await import("@/lib/telnyx-messaging-config")
  const candidates = await listActiveLinesFor10DlcAssignment(ownerUserId, organizationId)
  for (const e164 of candidates) {
    if (await isTelnyxOwnedNumber(e164)) return e164
  }
  return candidates[0] ?? null
}

/** Active provider-linked lines for an owner/org (oldest first) — used for 10DLC retries. */
export async function listActiveLinesFor10DlcAssignment(
  ownerUserId: string,
  organizationId?: string | null
): Promise<string[]> {
  const orgId = organizationId ?? null
  const out: string[] = []
  const push = (raw: string | null | undefined) => {
    const e164 = raw?.trim() ? normalizePhoneNumberE164(raw) : ""
    if (e164 && !out.includes(e164)) out.push(e164)
  }

  if (!orgId || orgId.startsWith("legacy-")) {
    const lines = await getPhoneNumbers(ownerUserId)
    for (const line of lines) {
      if (line.status !== "active") continue
      if (!(line.provider_number_sid?.trim() || line.twilio_sid?.trim())) continue
      push(line.number)
    }
    return out
  }

  const [numbers, portOrders] = await Promise.all([
    getPhoneNumbers(ownerUserId, orgId),
    listPortingOrdersForOwner(ownerUserId, orgId),
  ])

  const openPort = portOrders.find(isOpenPortOrder)
  if (openPort?.phone_number?.trim()) {
    const portE164 = normalizePhoneNumberE164(openPort.phone_number)
    const portRow = numbers.find((n) => normalizePhoneNumberE164(n.number) === portE164)
    if (
      portRow?.status === "active" &&
      Boolean(portRow.provider_number_sid?.trim() || portRow.twilio_sid?.trim())
    ) {
      push(portE164)
    }
    return out
  }

  const portingRow = numbers.find((n) => n.status === "porting")
  if (portingRow) return out

  for (const line of numbers) {
    if (line.status !== "active") continue
    if (!(line.provider_number_sid?.trim() || line.twilio_sid?.trim())) continue
    push(line.number)
  }
  return out
}
