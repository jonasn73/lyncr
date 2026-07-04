// GET /api/cron/recover-leads — send recovery SMS for lost_lead rows older than 20 minutes.
// Trigger from Vercel Cron (or manually with CRON_SECRET bearer token).

import { NextRequest, NextResponse } from "next/server"
import { listLostLeadsPendingRecovery, markLostLeadRecoverySms } from "@/lib/lost-leads"
import { generateLostLeadRecoverySms } from "@/lib/lost-lead-recovery-sms"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

export const dynamic = "force-dynamic"

const MIN_AGE_MINUTES = 20

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (secret) {
    const auth = req.headers.get("authorization") || ""
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  try {
    const pending = await listLostLeadsPendingRecovery(MIN_AGE_MINUTES, 20)
    let sent = 0
    let failed = 0
    const details: { id: string; ok: boolean; error?: string }[] = []

    for (const row of pending) {
      const smsBody = await generateLostLeadRecoverySms(row)
      const result = await sendTelnyxSms({
        toE164: row.phone_number,
        text: smsBody,
        userId: row.user_id,
      })

      if (result.ok) {
        sent += 1
        await markLostLeadRecoverySms({ id: row.id, body: smsBody, error: null })
        details.push({ id: row.id, ok: true })
      } else {
        failed += 1
        await markLostLeadRecoverySms({ id: row.id, body: smsBody, error: result.error })
        details.push({ id: row.id, ok: false, error: result.error })
      }
    }

    return NextResponse.json({
      data: {
        scanned: pending.length,
        sent,
        failed,
        min_age_minutes: MIN_AGE_MINUTES,
        details,
      },
    })
  } catch (e) {
    console.error("[GET /api/cron/recover-leads]", e)
    return NextResponse.json({ error: "Recovery cron failed" }, { status: 500 })
  }
}
