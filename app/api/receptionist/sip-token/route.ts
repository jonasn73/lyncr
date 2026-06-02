// GET /api/receptionist/sip-token — mint a short-lived Telnyx WebRTC login token so the
// signed-in receptionist's browser can register with the @telnyx/webrtc SDK and take calls
// in-browser. Fully automated: if the agent has no SIP credential yet, we provision one on
// the spot (Telnyx Telephony Credential under TELNYX_CREDENTIAL_CONNECTION_ID), persist it,
// then mint the token from it — so the user never has to leave lyncr.app.
//
// Always returns HTTP 200 (outside auth) with a discriminated status so the browser client can
// branch without try/catch:
//   { data: { status: "ready", token, sipUsername } }   → register the browser
//   { data: { status: "not_provisioned", reason } }      → stay inert (route falls back to CELL)

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getReceptionistPortalContext } from "@/lib/receptionist-portal-auth"
import { setReceptionistSipCredential } from "@/lib/db"
import {
  mintTelnyxSipToken,
  provisionTelnyxSipCredential,
  readTelnyxApiKey,
  readTelnyxSharedCredentialId,
} from "@/lib/telnyx-sip-provisioning"

type TokenResult =
  | { status: "ready"; token: string; sipUsername: string }
  | { status: "not_provisioned"; reason: string }

function notProvisioned(reason: string) {
  return NextResponse.json({ data: { status: "not_provisioned", reason } as TokenResult })
}

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

    if (!readTelnyxApiKey()) return notProvisioned("TELNYX_API_KEY not set")

    let credentialId = ctx.receptionist.sip_credential_id?.trim() || ""
    let sipUsername = ctx.receptionist.sip_username?.trim() || ""

    // Auto-provision a dedicated credential the first time this agent goes WEB.
    if (!credentialId) {
      const provision = await provisionTelnyxSipCredential({ label: `lyncr-agent-${ctx.receptionist.id}` })
      if (provision.status === "provisioned") {
        await setReceptionistSipCredential(ctx.receptionist.id, {
          sipUsername: provision.sipUsername,
          credentialId: provision.credentialId,
        })
        credentialId = provision.credentialId
        sipUsername = provision.sipUsername
      } else {
        // Fall back to a single shared credential id if one is configured (interim setup),
        // otherwise report why provisioning was skipped so the client stays on CELL.
        const shared = readTelnyxSharedCredentialId()
        if (!shared) return notProvisioned(provision.reason)
        credentialId = shared
      }
    }

    const token = await mintTelnyxSipToken(credentialId)
    if (!token) return notProvisioned("could not mint Telnyx token")

    const result: TokenResult = { status: "ready", token, sipUsername }
    return NextResponse.json({ data: result })
  } catch (error) {
    console.error("[lyncr] sip token:", error)
    // Never hard-fail the browser client — degrade to CELL.
    return notProvisioned("server error")
  }
}
