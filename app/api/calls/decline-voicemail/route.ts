// POST /api/calls/decline-voicemail — redirect inbound TeXML call to fallback / voicemail.

import { NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { getUserIdFromRequest } from "@/lib/auth"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getAppUrl } from "@/lib/telnyx"
import { telnyxCallControlHangup } from "@/lib/telnyx-call-control-api"
import { telnyxTexmlRedirectCall } from "@/lib/telnyx-texml-update-call"

export const dynamic = "force-dynamic"

function sqlClient() {
  const url = resolveNeonDatabaseUrl()
  if (!url) throw new Error("DATABASE_URL is not configured")
  return neon(url)
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "")
}

/** Build the same fallback TeXML URL inbound Dial action uses. */
function fallbackTexmlUrl(userId: string, toNumber: string | null): string {
  const appUrl = getAppUrl().replace(/\/$/, "")
  const did = digitsOnly(toNumber || "")
  if (did.length >= 10) {
    return `${appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(userId)}/n/${did}`
  }
  return `${appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(userId)}`
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
  let toNumber: string | null = null

  try {
    const sql = sqlClient()
    if (callId) {
      const rows = await sql`
        SELECT provider_call_sid, to_number
        FROM call_logs
        WHERE id = ${callId}::uuid AND user_id = ${userId}
        LIMIT 1
      `
      const row = rows[0] as { provider_call_sid?: string; to_number?: string } | undefined
      if (!providerSid) providerSid = String(row?.provider_call_sid ?? "").trim()
      toNumber = row?.to_number ? String(row.to_number) : null
    } else if (providerSid) {
      const rows = await sql`
        SELECT to_number
        FROM call_logs
        WHERE user_id = ${userId}
          AND (provider_call_sid = ${providerSid} OR twilio_call_sid = ${providerSid})
        ORDER BY created_at DESC
        LIMIT 1
      `
      toNumber = rows[0]?.to_number ? String(rows[0].to_number) : null
    }

    if (!providerSid) {
      return NextResponse.json(
        { error: "Missing call id", data: { hung_up: false, redirected: false, reason: "missing_call_sid" } },
        { status: 400 }
      )
    }

    // Prefer TeXML redirect → voicemail/fallback (production inbound path).
    const redirectUrl = fallbackTexmlUrl(userId, toNumber)
    const redirected = await telnyxTexmlRedirectCall({ callSid: providerSid, url: redirectUrl })

    let hungUp = false
    let carrierError: string | null = redirected.ok ? null : redirected.error

    // If TeXML redirect fails (e.g. Call Control leg), try Call Control hangup as last resort.
    if (!redirected.ok) {
      const hangup = await telnyxCallControlHangup(providerSid)
      hungUp = hangup.ok
      if (!hangup.ok) {
        carrierError = hangup.error || carrierError
      } else {
        carrierError = null
      }
    }

    const carrierOk = redirected.ok || hungUp

    // Only stamp the call log when the carrier actually accepted the action.
    if (carrierOk) {
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
    }

    if (!carrierOk) {
      return NextResponse.json(
        {
          error: carrierError || "Could not send caller to voicemail",
          data: {
            hung_up: false,
            redirected: false,
            reason: "carrier_rejected",
            error: carrierError,
          },
        },
        { status: 502 }
      )
    }

    return NextResponse.json({
      data: {
        hung_up: hungUp,
        redirected: redirected.ok,
        error: null,
      },
    })
  } catch (e) {
    console.error("[POST /api/calls/decline-voicemail]", e)
    return NextResponse.json({ error: "Could not decline call" }, { status: 500 })
  }
}
