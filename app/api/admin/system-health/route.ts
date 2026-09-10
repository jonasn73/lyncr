// GET /api/admin/system-health — Neon/Telnyx up-down status plus Telnyx webhook
// signature-verification state, for the /admin/infra "System Health" panel (admin only).
// The underlying data already existed (platform-health cron, webhook_signature_alerts) but
// had no visible home — this was previously alert-only (SMS/email at the moment something
// went wrong), with nothing to check afterward.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getPlatformHealthSnapshot, listWebhookSignatureAlertState } from "@/lib/db"
import { TELNYX_WEBHOOK_SIGNATURE_ROUTES, webhookSignatureAlertKey } from "@/lib/telnyx-webhook-alerts"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const [neon, telnyx, alertRows] = await Promise.all([
      getPlatformHealthSnapshot("neon").catch(() => null),
      getPlatformHealthSnapshot("telnyx").catch(() => null),
      listWebhookSignatureAlertState().catch(() => []),
    ])

    const alertsByKey = new Map(alertRows.map((row) => [row.alert_key, row]))

    const webhookRoutes = TELNYX_WEBHOOK_SIGNATURE_ROUTES.map(({ routeLabel, enforced }) => {
      const row = alertsByKey.get(webhookSignatureAlertKey(routeLabel))
      return {
        route_label: routeLabel,
        enforced,
        event_count_since_last_alert: row?.event_count ?? 0,
        first_event_at: row?.first_event_at ?? null,
        last_event_at: row?.last_event_at ?? null,
        last_alerted_at: row?.last_alerted_at ?? null,
      }
    })

    return NextResponse.json({
      data: {
        neon: neon
          ? { status: neon.status, last_error_at: neon.last_error_at, last_ok_at: neon.last_ok_at }
          : { status: "unknown" as const, last_error_at: null, last_ok_at: null },
        telnyx: telnyx
          ? { status: telnyx.status, last_error_at: telnyx.last_error_at, last_ok_at: telnyx.last_ok_at }
          : { status: "unknown" as const, last_error_at: null, last_ok_at: null },
        webhook_routes: webhookRoutes,
      },
    })
  } catch (e) {
    console.error("[lyncr-admin] system-health:", e)
    return NextResponse.json({ error: "Failed to load system health" }, { status: 500 })
  }
}
