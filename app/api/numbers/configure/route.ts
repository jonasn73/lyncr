// ============================================
// POST /api/numbers/configure
// ============================================
// Auto-configures ALL of a user's phone numbers with the lyncr TeXML webhook.
// This runs silently on every settings page load to ensure:
//   1. Numbers purchased before auto-config was added still work
//   2. Ported numbers that completed get wired up
//   3. Any number that lost its webhook config gets fixed
//   4. The TeXML app has an outbound voice profile (required for Dial)
// Also syncs Telnyx numbers into the local DB if missing, and backfills the carrier id
// on rows that already exist without one.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getPhoneNumbers,
  insertPhoneNumber,
  updatePhoneNumber,
  getPhoneNumberByNumberAndStatus,
  normalizePhoneNumberE164,
} from "@/lib/db"
import {
  getOrCreateTexmlApp,
  configureNumberVoice,
} from "@/lib/telnyx-config"
import { getOrCreateCallControlApp } from "@/lib/telnyx-call-control-config"
import { readInboundCallControlEnabled } from "@/lib/telnyx-call-control-inbound"
import { listTelnyxAccountPhoneNumbers } from "@/lib/telnyx-number-sync"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const results: { number: string; action: string }[] = []

    // Step 1: Find or create the lyncr voice connection (Call Control when enabled, else TeXML).
    const texmlAppId = await getOrCreateTexmlApp()
    const voiceConnectionId = readInboundCallControlEnabled()
      ? await getOrCreateCallControlApp()
      : texmlAppId

    const telnyxNumbers = await listTelnyxAccountPhoneNumbers()

    const dbNumbers = await getPhoneNumbers(userId)
    const dbByDigits = new Map(
      dbNumbers.map((n) => [normalizePhoneNumberE164(n.number).replace(/\D/g, ""), n] as const)
    )
    const dbDigitSet = new Set(dbByDigits.keys())

    for (const tn of telnyxNumbers) {
      if (!tn.phone_number) continue
      const e164 = normalizePhoneNumberE164(tn.phone_number)
      const digitKey = e164.replace(/\D/g, "")
      const existingRow = digitKey ? dbByDigits.get(digitKey) : undefined

      // A line the owner retired is no longer ours to manage: do not backfill its carrier id
      // and do not re-point its voice webhook. Telnyx may still list it (releasing there is a
      // console action), and getPhoneNumbers returns every status, so without this the
      // reconciliation kept touching numbers that had been taken out of service.
      if (existingRow?.status === "released") {
        results.push({ number: e164, action: "skipped (released)" })
        continue
      }

      if (digitKey && !dbDigitSet.has(digitKey)) {
        const existingInDb = await getPhoneNumberByNumberAndStatus(e164, "active")
        if (!existingInDb) {
          await insertPhoneNumber({
            user_id: userId,
            number: e164,
            friendly_name: e164,
            label: "Business Line",
            type: "local",
            status: "active",
            provider_number_sid: tn.id,
          })
          results.push({ number: e164, action: "added to database" })
          dbDigitSet.add(digitKey)
        }
      } else if (digitKey && tn.id) {
        // The row is already here but never got a carrier id. The insert branch above can
        // never repair that — the digit-set check passes, so it is skipped on every run —
        // and without provider_number_sid the line drops out of SMS sending and
        // primary-line resolution while still looking active in the UI.
        if (existingRow && !existingRow.provider_number_sid?.trim()) {
          await updatePhoneNumber(existingRow.id, userId, { provider_number_sid: tn.id })
          existingRow.provider_number_sid = tn.id
          results.push({ number: e164, action: "carrier id backfilled" })
        }
      }

      // Configure voice if not pointing at the active inbound connection.
      if (tn.connection_id !== voiceConnectionId) {
        await configureNumberVoice(e164, texmlAppId)
        results.push({ number: tn.phone_number, action: "voice configured" })
      } else {
        results.push({ number: tn.phone_number, action: "already configured" })
      }
    }

    return NextResponse.json({ success: true, configured: results.length, results })
  } catch (error) {
    console.error("[lyncr] Configure numbers error:", error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
