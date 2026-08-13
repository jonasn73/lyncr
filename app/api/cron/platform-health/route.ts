// GET /api/cron/platform-health — ping Neon + Telnyx and SMS platform admins on red/recovery.
// Vercel Cron every 5 minutes. Same CRON_SECRET Bearer pattern as other Lyncr crons.

import { NextRequest, NextResponse } from "next/server"
import { isAuthorizedCronRequest } from "@/lib/cron-auth"
import {
  getPlatformHealthSnapshot,
  listPlatformAdminContacts,
  upsertPlatformHealthSnapshot,
  pingNeonDatabase,
} from "@/lib/db"
import { pingTelnyxApi } from "@/lib/telnyx"
import {
  decidePlatformHealthAlert,
  formatPlatformHealthAlertMessage,
  type PlatformHealthCheckName,
  type PlatformHealthStatus,
} from "@/lib/platform-health-alerts"
import { deliverPlatformHealthAlert } from "@/lib/platform-health-notify"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  // Reject random browsers if CRON_SECRET is set in Vercel.
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    // Same pings the /admin metrics strip uses.
    const [neonOk, telnyxStatus] = await Promise.all([pingNeonDatabase(), pingTelnyxApi()])
    const neonStatus: PlatformHealthStatus = neonOk ? "ok" : "error"
    const checks: { name: PlatformHealthCheckName; status: PlatformHealthStatus }[] = [
      { name: "neon", status: neonStatus },
      { name: "telnyx", status: telnyxStatus },
    ]

    // Load platform admins once — never shop owners.
    const admins = await listPlatformAdminContacts()
    const details: {
      check: PlatformHealthCheckName
      status: PlatformHealthStatus
      action: string
      reason: string
      notified: number
    }[] = []

    for (const check of checks) {
      // Read last snapshot before we overwrite it (needed for debounce + recovery).
      const previous = await getPlatformHealthSnapshot(check.name)
      const decision = decidePlatformHealthAlert({
        currentStatus: check.status,
        previous,
      })

      let notified = 0
      if (decision.action !== "none") {
        const text = formatPlatformHealthAlertMessage({
          checkName: check.name,
          action: decision.action,
          status: check.status,
        })
        for (const admin of admins) {
          const result = await deliverPlatformHealthAlert({ user: admin, text })
          if (result.channel !== "skipped") notified += 1
        }
      }

      // Always persist the latest status; only stamp alert times when we actually notified.
      await upsertPlatformHealthSnapshot({
        checkName: check.name,
        status: check.status,
        markDownAlert: decision.action === "alert_down",
        markRecoveryAlert: decision.action === "alert_up",
      })

      details.push({
        check: check.name,
        status: check.status,
        action: decision.action,
        reason: decision.reason,
        notified,
      })
    }

    return NextResponse.json({
      data: {
        neon: neonStatus,
        telnyx: telnyxStatus,
        admin_count: admins.length,
        details,
      },
    })
  } catch (e) {
    console.error("[GET /api/cron/platform-health]", e)
    const msg = e instanceof Error ? e.message : "Platform health check failed"
    if (msg.includes("136-platform-health")) {
      return NextResponse.json({ error: msg }, { status: 503 })
    }
    return NextResponse.json({ error: "Platform health check failed" }, { status: 500 })
  }
}
