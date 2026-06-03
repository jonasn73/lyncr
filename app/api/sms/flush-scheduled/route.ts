// ============================================
// GET /api/sms/flush-scheduled
// ============================================
// Sends any scheduled texts that are now due (e.g. post-job review requests). Triggered by the
// platform scheduler. Also runs opportunistically from dashboards, so this is belt-and-suspenders.

import { NextRequest, NextResponse } from "next/server"
import { flushDueScheduledSms } from "@/lib/sms-pipeline"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  // When a scheduler secret is configured, require it (cron sends it as a bearer token).
  const secret = process.env.CRON_SECRET?.trim()
  if (secret) {
    const auth = req.headers.get("authorization") || ""
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  try {
    const result = await flushDueScheduledSms(40)
    return NextResponse.json({ data: result })
  } catch (e) {
    console.error("[GET /api/sms/flush-scheduled] failed:", e)
    return NextResponse.json({ error: "Flush failed" }, { status: 500 })
  }
}
