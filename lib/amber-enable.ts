/**
 * Enable Amber for a shop — buy business-owned control DID + wire workspace.
 */

import {
  findActivePhoneNumberIdForOwner,
  insertAmberAuditEvent,
  markPhoneNumberAsAmberControl,
  upsertAmberWorkspace,
} from "@/lib/amber-db"
import { getPhoneNumbers, normalizePhoneNumberE164 } from "@/lib/db"
import { purchasePhoneNumberForUser } from "@/lib/number-allocation"
import { getTelnyxApiKey } from "@/lib/telnyx-config"

const AMBER_LABEL = "Amber · Lyncr"
const TELNYX_BASE = "https://api.telnyx.com/v2"

function areaCodeFromE164(e164: string): string | null {
  const digits = e164.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1, 4)
  if (digits.length === 10) return digits.slice(0, 3)
  return null
}

async function searchOneLocalNumber(areaCode: string): Promise<string | null> {
  getTelnyxApiKey()
  const params = new URLSearchParams({
    "filter[country_code]": "US",
    "filter[national_destination_code]": areaCode,
    "filter[phone_number_type]": "local",
    "filter[features][]": "voice",
    "filter[limit]": "10",
    "page[size]": "10",
    "page[number]": "1",
  })
  const res = await fetch(`${TELNYX_BASE}/available_phone_numbers?${params}`, {
    headers: {
      Authorization: `Bearer ${getTelnyxApiKey()}`,
      "Content-Type": "application/json",
    },
  })
  const body = (await res.json().catch(() => null)) as {
    data?: Array<{ phone_number?: string }>
  } | null
  if (!res.ok) return null
  const first = body?.data?.[0]?.phone_number?.trim()
  return first ? normalizePhoneNumberE164(first) : null
}

export async function enableAmberForWorkspace(params: {
  userId: string
  organizationId: string | null
  timezone?: string
}): Promise<
  | { ok: true; amberNumber: string; phoneNumberId: string }
  | { ok: false; error: string; reason?: string }
> {
  const existing = await getPhoneNumbers(params.userId, params.organizationId)
  const alreadyAmber = existing.find((n) => n.is_amber_control && n.status === "active")
  if (alreadyAmber) {
    await markPhoneNumberAsAmberControl(alreadyAmber.id)
    await upsertAmberWorkspace({
      userId: params.userId,
      organizationId: params.organizationId,
      phoneNumberId: alreadyAmber.id,
      enabled: true,
      timezone: params.timezone,
    })
    await insertAmberAuditEvent({
      userId: params.userId,
      organizationId: params.organizationId,
      eventType: "enabled_existing",
      detail: { number: alreadyAmber.number },
    })
    return { ok: true, amberNumber: alreadyAmber.number, phoneNumberId: alreadyAmber.id }
  }

  const customerLine = existing.find(
    (n) =>
      n.status === "active" &&
      !n.is_amber_control &&
      Boolean(n.provider_number_sid?.trim())
  )
  const area =
    (customerLine ? areaCodeFromE164(customerLine.number) : null) ||
    "502"

  let purchased: string | null = null
  let lastError = "No numbers available in that area"
  for (const code of [area, "502", "212"]) {
    const candidate = await searchOneLocalNumber(code)
    if (!candidate) continue
    const result = await purchasePhoneNumberForUser(
      params.userId,
      candidate,
      AMBER_LABEL,
      candidate,
      params.organizationId
    )
    if (result.ok) {
      purchased = result.phone_number
      break
    }
    lastError = result.error
    if (result.reason === "tier_limit" || result.reason === "insufficient_credit") {
      return { ok: false, error: result.error, reason: result.reason }
    }
  }

  if (!purchased) {
    return { ok: false, error: lastError, reason: "carrier_error" }
  }

  const phoneNumberId = await findActivePhoneNumberIdForOwner({
    userId: params.userId,
    e164: purchased,
    organizationId: params.organizationId,
  })
  if (!phoneNumberId) {
    return { ok: false, error: "Amber number purchased but not found in account.", reason: "db" }
  }

  await markPhoneNumberAsAmberControl(phoneNumberId)
  await upsertAmberWorkspace({
    userId: params.userId,
    organizationId: params.organizationId,
    phoneNumberId,
    enabled: true,
    timezone: params.timezone,
  })
  await insertAmberAuditEvent({
    userId: params.userId,
    organizationId: params.organizationId,
    eventType: "enabled_purchased",
    detail: { number: purchased },
  })

  return { ok: true, amberNumber: purchased, phoneNumberId }
}
