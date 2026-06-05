// POST /api/numbers/external — link a Twilio / external DID to Lyncr TeXML (no port purchase)

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getDefaultOrganizationForOwner,
  getOrganizationForOwner,
  getPhoneNumbers,
  insertExternalPhoneLine,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { getAppUrl } from "@/lib/telnyx"

export const dynamic = "force-dynamic"

export async function GET() {
  const webhookUrl = `${getAppUrl()}/api/voice/telnyx/incoming`
  return NextResponse.json({
    data: {
      texml_webhook_url: webhookUrl,
      instructions:
        "In Twilio Console → Phone Numbers → your number → Voice & Fax, set the webhook to POST to this URL (TeXML).",
    },
  })
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    organization_id?: string
    label?: string
    number?: string
    phone?: string
  }
  const label = String(body.label ?? "").trim()
  const rawNumber = String(body.number ?? body.phone ?? "").trim()
  if (!label || label.length < 2) {
    return NextResponse.json({ error: "Line label is required" }, { status: 400 })
  }
  const digits = rawNumber.replace(/\D/g, "")
  if (digits.length < 10) {
    return NextResponse.json({ error: "Enter a valid phone number in E.164 format (+1…)" }, { status: 400 })
  }

  let organizationId = String(body.organization_id ?? "").trim()
  if (!organizationId) {
    const def = await getDefaultOrganizationForOwner(userId)
    if (!def) return NextResponse.json({ error: "No workspace found" }, { status: 404 })
    organizationId = def.id
  }

  const org = await getOrganizationForOwner(organizationId, userId)
  if (!org) return NextResponse.json({ error: "Workspace not found" }, { status: 404 })

  try {
    const line = await insertExternalPhoneLine({
      user_id: userId,
      organization_id: org.id,
      number: normalizePhoneNumberE164(rawNumber),
      label,
    })
    const numbers = await getPhoneNumbers(userId)
    return NextResponse.json({
      success: true,
      data: {
        line,
        numbers,
        texml_webhook_url: `${getAppUrl()}/api/voice/telnyx/incoming`,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not link external number"
    console.error("[POST /api/numbers/external] failed:", e)
    const needsMigration = /organizations|organization_id|migration|relation.*does not exist/i.test(msg)
    return NextResponse.json(
      { success: false, error: needsMigration ? "Run scripts/065-organizations-external-lines.sql in Neon first." : msg },
      { status: needsMigration ? 409 : /already registered/i.test(msg) ? 409 : 500 }
    )
  }
}
