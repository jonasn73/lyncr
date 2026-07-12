// POST /api/calls/hold — park a secondary inbound leg on telecom hold.

import { NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { getUserIdFromRequest } from "@/lib/auth"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { telnyxCallControlHold } from "@/lib/telnyx-call-control-api"

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
      return NextResponse.json({ data: { held: false, reason: "missing_call_sid" } })
    }

    const hold = await telnyxCallControlHold(providerSid)

    return NextResponse.json({
      data: {
        held: hold.ok,
        error: hold.ok ? null : hold.error,
      },
    })
  } catch (e) {
    console.error("[POST /api/calls/hold]", e)
    return NextResponse.json({ error: "Could not hold call" }, { status: 500 })
  }
}
