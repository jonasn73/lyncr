// ============================================
// POST /api/numbers/configure
// ============================================
// Auto-configures ALL of a user's phone numbers with the Sigo TeXML webhook.
// This runs silently on every settings page load to ensure:
//   1. Numbers purchased before auto-config was added still work
//   2. Ported numbers that completed get wired up
//   3. Any number that lost its webhook config gets fixed
//   4. The TeXML app has an outbound voice profile (required for Dial)
// Also syncs Telnyx numbers into the local DB if missing.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getPhoneNumbers,
  insertPhoneNumber,
  getPhoneNumberByNumberAndStatus,
} from "@/lib/db"
import {
  telnyxHeaders,
  getOrCreateTexmlApp,
} from "@/lib/telnyx-config"

const TELNYX_BASE = "https://api.telnyx.com/v2"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const results: { number: string; action: string }[] = []

    // Step 1: Find or create the Sigo Call Router TeXML app (with outbound voice profile)
    const texmlAppId = await getOrCreateTexmlApp()

    // Step 2: Get all Telnyx phone numbers on this account
    const telnyxNumbersRes = await fetch(
      `${TELNYX_BASE}/phone_numbers?page[size]=100`,
      { headers: telnyxHeaders() }
    )
    const telnyxNumbersBody = await telnyxNumbersRes.json()
    const telnyxNumbers: { id: string; phone_number: string; connection_id: string | null }[] =
      (telnyxNumbersBody?.data || []).map((n: Record<string, unknown>) => ({
        id: String(n.id),
        phone_number: String(n.phone_number || ""),
        connection_id: n.connection_id ? String(n.connection_id) : null,
      }))

    // Step 3: Get user's numbers from our DB
    const dbNumbers = await getPhoneNumbers(userId)
    const dbNumberSet = new Set(dbNumbers.map((n) => n.number))

    // Step 4: For each Telnyx number, ensure it's in our DB and configured with TeXML
    for (const tn of telnyxNumbers) {
      if (!tn.phone_number) continue

      // Add to DB if not already there
      if (!dbNumberSet.has(tn.phone_number)) {
        const existingInDb = await getPhoneNumberByNumberAndStatus(tn.phone_number, "active")
        if (!existingInDb) {
          await insertPhoneNumber({
            user_id: userId,
            number: tn.phone_number,
            friendly_name: tn.phone_number,
            label: "Business Line",
            type: "local",
            status: "active",
            provider_number_sid: tn.id,
          })
          results.push({ number: tn.phone_number, action: "added to database" })
        }
      }

      // Configure voice if not pointing to our TeXML app
      if (tn.connection_id !== texmlAppId) {
        const patchRes = await fetch(`${TELNYX_BASE}/phone_numbers/${tn.id}/voice`, {
          method: "PATCH",
          headers: telnyxHeaders(),
          body: JSON.stringify({ connection_id: texmlAppId, tech_prefix_enabled: false }),
        })
        if (patchRes.ok) {
          results.push({ number: tn.phone_number, action: "voice configured" })
        } else {
          const patchBody = await patchRes.json().catch(() => ({}))
          results.push({ number: tn.phone_number, action: `config failed: ${patchBody?.errors?.[0]?.detail || patchRes.status}` })
        }
      } else {
        results.push({ number: tn.phone_number, action: "already configured" })
      }
    }

    return NextResponse.json({ success: true, configured: results.length, results })
  } catch (error) {
    console.error("[Sigo] Configure numbers error:", error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
