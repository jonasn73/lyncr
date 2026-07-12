// POST /api/calls/decline-voicemail — hang up inbound leg so fallback/voicemail can take over.

import { NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { getUserIdFromRequest } from "@/lib/auth"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { telnyxCallControlHangup } from "@/lib/telnyx-call-control-api"

export const dynamic = "force-dynamic"

function sqlClient() {
  const url = resolveNeonDatabaseUrl()
  if (!url) throw new Error("DATABASE_URL is not configured")
  return neon(url)
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    call_id?: string
    provider_call_sid?: string
  }

  const callId = String(body.call_id ?? "").trim()
  let providerSid = String(body.provider_call_sid ?? "").trim()

  try {
    const sql = sqlClient()
    if (callId && !providerSid) {
      const rows = await sql`
        SELECT provider_call_sid
        FROM call_logs
        WHERE id = ${callId}::uuid AND user_id = ${userId}
        LIMIT 1
      `
      providerSid = String(rows[0]?.provider_call_sid ?? "").trim()
    }

    if (!providerSid) {
      return NextResponse.json({ data: { hung_up: false, reason: "missing_call_sid" } })
    }

    const hangup = await telnyxCallControlHangup(providerSid)

    try {
      if (callId) {
        await sql`
          UPDATE call_logs
          SET status = 'canceled',
              call_type = CASE WHEN call_type = 'incoming' THEN 'missed' ELSE call_type END,
              ended_at = COALESCE(ended_at, now())
          WHERE user_id = ${userId} AND id = ${callId}::uuid
        `
      } else {
        await sql`
          UPDATE call_logs
          SET status = 'canceled',
              call_type = CASE WHEN call_type = 'incoming' THEN 'missed' ELSE call_type END,
              ended_at = COALESCE(ended_at, now())
          WHERE user_id = ${userId}
            AND (provider_call_sid = ${providerSid} OR twilio_call_sid = ${providerSid})
        `
      }
    } catch (e) {
      console.warn("[decline-voicemail] status update skipped:", e)
    }

    return NextResponse.json({
      data: {
        hung_up: hangup.ok,
        error: hangup.ok ? null : hangup.error,
      },
    })
  } catch (e) {
    console.error("[POST /api/calls/decline-voicemail]", e)
    return NextResponse.json({ error: "Could not decline call" }, { status: 500 })
  }
}
