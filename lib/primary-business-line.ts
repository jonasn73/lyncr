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
  const orgId = organizationId ?? null
  if (!orgId || orgId.startsWith("legacy-")) {
    const lines = await getPhoneNumbers(ownerUserId)
    const active = lines.find(
      (line) =>
        line.status === "active" &&
        Boolean(line.provider_number_sid?.trim() || line.twilio_sid?.trim())
    )
    return active?.number?.trim() ? normalizePhoneNumberE164(active.number) : null
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
      return portE164
    }
    return null
  }

  const portingRow = numbers.find((n) => n.status === "porting")
  if (portingRow) return null

  const active = numbers.find(
    (line) =>
      line.status === "active" &&
      Boolean(line.provider_number_sid?.trim() || line.twilio_sid?.trim())
  )
  return active?.number?.trim() ? normalizePhoneNumberE164(active.number) : null
}
