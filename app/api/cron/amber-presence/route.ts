// GET /api/cron/amber-presence — flip Busy → Available when Amber until-time is due.

import { NextResponse } from "next/server"
import { isAuthorizedCronRequest } from "@/lib/cron-auth"
import { processAmberScheduledAvailable } from "@/lib/amber-handler"

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await processAmberScheduledAvailable()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error("[cron/amber-presence]", e)
    return NextResponse.json({ ok: false, error: "amber_cron_failed" }, { status: 500 })
  }
}
