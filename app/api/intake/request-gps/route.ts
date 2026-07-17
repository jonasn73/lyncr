// POST /api/intake/request-gps — text customer a /locate?c=… link via Telnyx (not Twilio).

import { NextRequest, NextResponse } from "next/server"
import Telnyx from "telnyx"
import { getSessionUser } from "@/lib/server-session-user"
import { isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"
import { createLiveGpsLocateToken } from "@/lib/live-gps-locate"
import { toE164 } from "@/lib/phone-e164"
import { resolveWorkspaceSmsSender } from "@/lib/workspace-sms-sender"
import { configureNumberMessaging } from "@/lib/telnyx-messaging-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Env DIDs that can be used as Telnyx SMS "from" (E.164). */
function resolveEnvOutboundNumber(): string | null {
  // Prefer the dedicated outbound var, then legacy aliases already used in Vercel.
  const keys = [
    "TELNYX_OUTBOUND_NUMBER",
    "TELNYX_MESSAGING_FROM_E164",
    "TELNYX_PHONE_NUMBER",
    "TELNYX_FROM_NUMBER",
    "TELNYX_SMS_FROM",
  ] as const
  for (const key of keys) {
    const raw = process.env[key]?.trim()
    if (!raw) continue
    const e164 = normalizePhoneNumberE164(raw)
    if (e164) return e164
  }
  return null
}

/** List which required Telnyx env vars are missing (clear operator-facing errors). */
function missingTelnyxSmsConfig(): string[] {
  const missing: string[] = []
  if (!process.env.TELNYX_API_KEY?.trim()) missing.push("TELNYX_API_KEY")
  if (!process.env.TELNYX_MESSAGING_PROFILE_ID?.trim()) missing.push("TELNYX_MESSAGING_PROFILE_ID")
  return missing
}

function formatTelnyxSdkError(err: unknown): string {
  if (!err || typeof err !== "object") {
    return err instanceof Error ? err.message : "Telnyx SMS failed"
  }
  const anyErr = err as {
    message?: string
    status?: number
    error?: { errors?: Array<{ code?: string; title?: string; detail?: string }> }
    errors?: Array<{ code?: string; title?: string; detail?: string }>
  }
  const first =
    anyErr.error?.errors?.[0] ||
    anyErr.errors?.[0] ||
    (anyErr as { response?: { data?: { errors?: Array<{ code?: string; title?: string; detail?: string }> } } })
      .response?.data?.errors?.[0]
  if (first) {
    const code = first.code ? `[${first.code}] ` : ""
    const title = first.title || "Telnyx error"
    const detail = first.detail ? `: ${first.detail}` : ""
    return `${code}${title}${detail}`
  }
  return anyErr.message || "Telnyx SMS failed"
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser() // Must be signed in
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = user.id

  // Fail fast with the exact missing Vercel/env keys (no Twilio leftovers).
  const missing = missingTelnyxSmsConfig()
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `Telnyx SMS is not configured. Missing environment variable(s): ${missing.join(", ")}. Set them in Vercel and redeploy.`,
        missing,
      },
      { status: 503 }
    )
  }

  const apiKey = process.env.TELNYX_API_KEY!.trim()
  const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID!.trim()

  let body: { phone?: string; call_log_id?: string; organization_id?: string | null }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Normalize customer phone to E.164 for Telnyx "to".
  const phone =
    normalizePhoneNumberE164(body.phone || "") || toE164(body.phone || "") || ""
  if (!isReasonablePstnDialString(phone)) {
    return NextResponse.json({ error: "Valid customer phone required" }, { status: 400 })
  }

  // Prefer this workspace's active Telnyx DID; fall back to platform outbound env.
  const sender = await resolveWorkspaceSmsSender(userId, body.organization_id ?? null)
  const envFrom = resolveEnvOutboundNumber()
  const fromE164 = sender.ok
    ? normalizePhoneNumberE164(sender.from_e164)
    : envFrom

  if (!fromE164) {
    return NextResponse.json(
      {
        error:
          sender.ok === false
            ? sender.message
            : "No Telnyx outbound number available. Set TELNYX_OUTBOUND_NUMBER (or TELNYX_MESSAGING_FROM_E164) in Vercel, or buy an SMS-ready business line under Settings → Lines.",
        missing: envFrom ? [] : ["TELNYX_OUTBOUND_NUMBER"],
      },
      { status: 502 }
    )
  }

  const created = await createLiveGpsLocateToken({
    ownerUserId: userId,
    callLogId: body.call_log_id?.trim() || null,
    customerPhone: phone,
  })
  if (!created) {
    return NextResponse.json(
      { error: "Could not create locate link. Run scripts/093-live-gps-locate.sql in Neon." },
      { status: 500 }
    )
  }

  const gpsRequestUrl = created.url
  const text = `Hi there! Please click here to share your exact live GPS location so our locksmith can navigate straight to your vehicle: ${gpsRequestUrl}`

  // Best-effort: attach the DID to the messaging profile before send (avoids Invalid source number).
  try {
    await configureNumberMessaging(fromE164)
  } catch (e) {
    console.warn("[request-gps] messaging profile assign warning:", e)
  }

  try {
    // Official Telnyx Node SDK — messages.send (v6); older docs called this messages.create.
    const telnyx = new Telnyx(apiKey)
    const response = await telnyx.messages.send({
      from: fromE164, // Active Telnyx phone number (source caller ID)
      messaging_profile_id: messagingProfileId, // Required for Telnyx SMS routing
      to: phone, // Already E.164
      text,
    })

    const messageId =
      (response as { data?: { id?: string } })?.data?.id ??
      (response as { id?: string })?.id ??
      null

    return NextResponse.json({
      data: {
        token_id: created.id,
        url: created.url,
        from: fromE164,
        messaging_profile_id: messagingProfileId,
        message_id: messageId,
      },
    })
  } catch (e) {
    const detail = formatTelnyxSdkError(e)
    console.error("[request-gps] Telnyx SMS failed:", {
      to: phone,
      from: fromE164,
      messaging_profile_id: messagingProfileId,
      detail,
    })
    return NextResponse.json(
      {
        error: detail,
        from: fromE164,
        messaging_profile_id: messagingProfileId,
      },
      { status: 502 }
    )
  }
}
