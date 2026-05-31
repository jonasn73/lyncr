// GET /api/receptionist/webrtc-token — mint a short-lived Telnyx WebRTC login token so the
// signed-in receptionist's browser can register with the @telnyx/webrtc SDK.
//
// Returns (HTTP 200 in all non-auth cases so the browser client can branch without try/catch):
//   { data: { status: "ready", token, sipUsername } }            → register the browser
//   { data: { status: "not_provisioned", reason } }              → stay inert (fall back to CELL)
//
// PROVISIONING (still required for WEB to carry audio):
//   1. Create a Telnyx **Credential Connection** in the Telnyx portal.
//   2. Create a **Telephony Credential** on it; set TELNYX_WEBRTC_CREDENTIAL_ID in the env
//      (interim single shared credential — production should store one credential id per receptionist).
//   3. Store the receptionist's SIP username in receptionists.sip_username.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getReceptionistPortalContext } from "@/lib/receptionist-portal-auth"

type TokenResult =
  | { status: "ready"; token: string; sipUsername: string }
  | { status: "not_provisioned"; reason: string }

export async function GET(req: NextRequest) {
  // Auth: only a signed-in receptionist may mint a token for their own browser.
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const ctx = await getReceptionistPortalContext(userId)
    if (!ctx) {
      return NextResponse.json({ error: "Receptionist portal access required" }, { status: 403 })
    }

    const apiKey = process.env.TELNYX_API_KEY?.trim()
    // Interim: a single shared credential id for testing. Production: store per-receptionist.
    const credentialId = process.env.TELNYX_WEBRTC_CREDENTIAL_ID?.trim()
    const sipUsername = ctx.receptionist.sip_username?.trim() || ""

    // Any missing piece → not provisioned. The client treats this as "WEB unavailable" and stays on CELL.
    if (!apiKey || !credentialId || !sipUsername) {
      const reason = !apiKey
        ? "TELNYX_API_KEY not set"
        : !credentialId
          ? "TELNYX_WEBRTC_CREDENTIAL_ID not set"
          : "receptionist has no sip_username"
      const result: TokenResult = { status: "not_provisioned", reason }
      return NextResponse.json({ data: result })
    }

    // Mint a short-lived JWT bound to the Telnyx Telephony Credential (returned as plain text).
    const res = await fetch(`https://api.telnyx.com/v2/telephony_credentials/${credentialId}/token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    })
    if (!res.ok) {
      const result: TokenResult = { status: "not_provisioned", reason: `telnyx token ${res.status}` }
      return NextResponse.json({ data: result })
    }
    const token = (await res.text()).trim()
    if (!token) {
      const result: TokenResult = { status: "not_provisioned", reason: "empty token" }
      return NextResponse.json({ data: result })
    }

    const result: TokenResult = { status: "ready", token, sipUsername }
    return NextResponse.json({ data: result })
  } catch (error) {
    console.error("[lyncr] webrtc token:", error)
    // Never hard-fail the browser client — degrade to CELL.
    return NextResponse.json({ data: { status: "not_provisioned", reason: "server error" } })
  }
}
