// Reconcile Telnyx-owned DIDs into Neon when carrier purchase succeeded but DB insert did not.

import {
  clearIncomingRoutingCache,
  getOnboardingProfile,
  getPhoneNumberByNumberAndStatus,
  getPhoneNumbers,
  insertPhoneNumber,
  isReasonablePstnDialString,
  listPortingOrdersForOwner,
  normalizePhoneNumberE164,
  syncInboundDialSnapshotForUser,
} from "@/lib/db"
import { getTelnyxApiKey, telnyxHeaders } from "@/lib/telnyx-config"

const TELNYX_BASE = "https://api.telnyx.com/v2"

export type TelnyxListedNumber = {
  id: string
  phone_number: string
  connection_id: string | null
}

/** List phone numbers on the platform Telnyx account (paginated first page). */
export async function listTelnyxAccountPhoneNumbers(): Promise<TelnyxListedNumber[]> {
  getTelnyxApiKey()
  const res = await fetch(`${TELNYX_BASE}/phone_numbers?page[size]=100`, {
    headers: telnyxHeaders(),
    cache: "no-store",
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail =
      (body as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ||
      `Telnyx list numbers failed (HTTP ${res.status})`
    throw new Error(detail)
  }
  const body = (await res.json()) as { data?: Record<string, unknown>[] }
  return (body.data ?? []).map((n) => ({
    id: String(n.id ?? ""),
    phone_number: String(n.phone_number ?? ""),
    connection_id: n.connection_id != null ? String(n.connection_id) : null,
  }))
}

function userOwnsNumberDigit(userNumbers: { number: string }[], e164: string): boolean {
  const key = normalizePhoneNumberE164(e164).replace(/\D/g, "")
  return userNumbers.some((n) => normalizePhoneNumberE164(n.number).replace(/\D/g, "") === key)
}

/** E.164 candidates this owner may legitimately own — never every DID on the shared Telnyx account. */
async function collectTelnyxSyncCandidatesForUser(
  userId: string
): Promise<Map<string, string | null>> {
  const candidates = new Map<string, string | null>()

  const profile = await getOnboardingProfile(userId)
  if (profile?.reserved_number?.trim()) {
    candidates.set(normalizePhoneNumberE164(profile.reserved_number), null)
  }

  const ports = await listPortingOrdersForOwner(userId)
  for (const port of ports) {
    const e164 = normalizePhoneNumberE164(port.phone_number)
    if (!e164) continue
    const orgId = port.organization_id?.trim()
    candidates.set(e164, orgId && !orgId.startsWith("legacy-") ? orgId : null)
  }

  const userNumbers = await getPhoneNumbers(userId)
  for (const row of userNumbers) {
    const e164 = normalizePhoneNumberE164(row.number)
    if (!e164) continue
    if (!candidates.has(e164)) {
      candidates.set(e164, row.organization_id ?? null)
    }
  }

  return candidates
}

/**
 * Insert Telnyx DIDs missing from Neon for this user.
 * Only reconciles numbers already tied to the account (reserved, porting, existing rows).
 */
export async function syncMissingTelnyxNumbersForUser(userId: string): Promise<{ added: string[] }> {
  const [telnyxNumbers, candidates, userNumbers] = await Promise.all([
    listTelnyxAccountPhoneNumbers(),
    collectTelnyxSyncCandidatesForUser(userId),
    getPhoneNumbers(userId),
  ])

  const telnyxByE164 = new Map<string, TelnyxListedNumber>()
  for (const tn of telnyxNumbers) {
    const e164 = normalizePhoneNumberE164(tn.phone_number)
    if (e164) telnyxByE164.set(e164, tn)
  }

  const added: string[] = []

  for (const [e164, organizationId] of candidates) {
    if (!e164 || !isReasonablePstnDialString(e164)) continue
    if (userOwnsNumberDigit(userNumbers, e164)) continue

    const ownedActive = await getPhoneNumberByNumberAndStatus(e164, "active")
    const ownedPorting = await getPhoneNumberByNumberAndStatus(e164, "porting")
    const owned = ownedActive ?? ownedPorting
    if (owned && owned.user_id !== userId) continue

    const tn = telnyxByE164.get(e164)
    if (!tn) continue

    if (!owned) {
      await insertPhoneNumber({
        user_id: userId,
        number: e164,
        friendly_name: e164,
        label: "Business Line",
        type: "local",
        status: "active",
        provider_number_sid: tn.id,
        organization_id: organizationId,
        assign_default_organization: organizationId == null,
      })
      added.push(e164)
      userNumbers.push({ number: e164 })
    }
  }

  if (added.length > 0) {
    clearIncomingRoutingCache()
    void syncInboundDialSnapshotForUser(userId).catch(() => {})
    console.log(
      JSON.stringify({
        zing: "telnyx-number-sync",
        userId,
        added,
      })
    )
  }

  return { added }
}
