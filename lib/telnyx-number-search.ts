const TELNYX_BASE = "https://api.telnyx.com/v2"

import { telnyxHeaders } from "@/lib/telnyx-config"

type TelnyxAvailableNumber = {
  phone_number: string
}

/** US area code from E.164 (+1XXXXXXXXXX). */
function areaCodeFromE164(e164: string): string | null {
  const digits = e164.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1, 4)
  if (digits.length === 10) return digits.slice(0, 3)
  return null
}

async function searchTelnyxNumbers(params: Record<string, string>): Promise<TelnyxAvailableNumber[]> {
  const qs = new URLSearchParams(params)
  qs.append("filter[features][]", "voice")
  const res = await fetch(`${TELNYX_BASE}/available_phone_numbers?${qs.toString()}`, {
    headers: telnyxHeaders(),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err =
      (body as { errors?: { detail?: string }[] })?.errors?.[0]?.detail || "Telnyx number search failed"
    throw new Error(String(err))
  }
  const rows = (body as { data?: TelnyxAvailableNumber[] })?.data ?? []
  return rows.filter((r) => r.phone_number?.trim())
}

/** Preferred DID, or the first available number in the same area code. */
export async function findPurchasableTelnyxNumber(preferredE164: string): Promise<string | null> {
  const area = areaCodeFromE164(preferredE164)
  if (!area) return null

  const rows = await searchTelnyxNumbers({
    "filter[country_code]": "US",
    "filter[national_destination_code]": area,
    "filter[limit]": "250",
  })
  if (rows.length === 0) return null

  const exact = rows.find((r) => r.phone_number === preferredE164)
  if (exact) return exact.phone_number

  return rows[0]?.phone_number ?? null
}
