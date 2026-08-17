// GET /api/cron/amber-presence — Busy-until flips + leftover book-form coworker pings.

import { NextResponse } from "next/server"
import { isAuthorizedCronRequest } from "@/lib/cron-auth"
import { processAmberScheduledAvailable } from "@/lib/amber-handler"
import { processAmberLeftoverBookJobs } from "@/lib/amber-coworker"

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const presence = await processAmberScheduledAvailable()
    const leftover = await processAmberLeftoverBookJobs()
    return NextResponse.json({ ok: true, ...presence, leftover })
  } catch (e) {
    console.error("[cron/amber-presence]", e)
    return NextResponse.json({ ok: false, error: "amber_cron_failed" }, { status: 500 })
  }
}
