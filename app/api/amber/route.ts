// GET /api/amber — Amber status for the active shop
// POST /api/amber — enable (buy control DID) | disable | verify mobile start/confirm

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  consumeAmberMobileVerification,
  createAmberMobileVerification,
  generateAmberVerifyCode,
  getAmberWorkspace,
  insertAmberAuditEvent,
  setAmberEnabled,
  setAmberOwnerMobileVerified,
} from "@/lib/amber-db"
import { enableAmberForWorkspace } from "@/lib/amber-enable"
import { sendAmberOwnerSms } from "@/lib/amber-owner-sms"
import { getOnboardingProfile, getUser, normalizePhoneNumberE164, isReasonablePstnDialString } from "@/lib/db"
import { resolveLeadAlertSmsRecipient } from "@/lib/lead-sms-recipient"
import { resolveBrowserTimezone } from "@/lib/telemetry-timezone"

function orgFrom(req: NextRequest, body?: { organization_id?: string }): string | null {
  const q = req.nextUrl.searchParams.get("organization_id")?.trim()
  const b = body?.organization_id?.trim()
  const raw = b || q || null
  if (!raw || raw.startsWith("legacy-")) return null
  return raw
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const organizationId = orgFrom(req)
    const row = await getAmberWorkspace({ userId, organizationId })
    // Same personal cell Lyncr already uses for Instant lead / Latest alerts.
    const [profile, user] = await Promise.all([getOnboardingProfile(userId), getUser(userId)])
    const suggestedMobile = resolveLeadAlertSmsRecipient(profile, user)

    return NextResponse.json({
      data: {
        enabled: Boolean(row?.enabled),
        amber_number: row?.amber_number ?? null,
        owner_mobile_e164: row?.owner_mobile_e164 ?? null,
        owner_mobile_verified: Boolean(row?.owner_mobile_verified_at),
        // Prefill verify field — still requires one code so Amber only obeys that phone.
        suggested_mobile_e164: suggestedMobile,
        presence_available_at: row?.presence_available_at ?? null,
        timezone: row?.timezone ?? "America/New_York",
        display_name: "Amber · Lyncr",
        promise: "Amber is your business assistant by text.",
      },
    })
  } catch (e) {
    const code = (e as Error & { code?: string }).code
    if (code === "AMBER_MIGRATION_REQUIRED") {
      return NextResponse.json(
        { error: (e as Error).message, code },
        { status: 503 }
      )
    }
    console.error("[GET /api/amber]", e)
    return NextResponse.json({ error: "Failed to load Amber" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string
      organization_id?: string
      mobile?: string
      code?: string
      timezone?: string
    }
    const action = String(body.action || "").trim()
    const organizationId = orgFrom(req, body)

    if (action === "enable") {
      const tz =
        (typeof body.timezone === "string" && body.timezone.trim()) ||
        resolveBrowserTimezone()
      const result = await enableAmberForWorkspace({
        userId,
        organizationId,
        timezone: tz,
      })
      if (!result.ok) {
        const status =
          result.reason === "tier_limit" ? 403 : result.reason === "insufficient_credit" ? 402 : 422
        return NextResponse.json({ error: result.error, reason: result.reason }, { status })
      }
      return NextResponse.json({
        data: {
          amber_number: result.amberNumber,
          phone_number_id: result.phoneNumberId,
          message:
            "Amber is on. Verify your personal mobile, then save this number as Amber · Lyncr.",
        },
      })
    }

    if (action === "disable") {
      await setAmberEnabled({ userId, organizationId, enabled: false })
      await insertAmberAuditEvent({
        userId,
        organizationId,
        eventType: "disabled",
        detail: {},
      })
      return NextResponse.json({ data: { enabled: false } })
    }

    if (action === "verify_start") {
      const mobile = normalizePhoneNumberE164(String(body.mobile || ""))
      if (!mobile || !isReasonablePstnDialString(mobile)) {
        return NextResponse.json({ error: "Enter a valid US mobile number." }, { status: 400 })
      }
      const workspace = await getAmberWorkspace({ userId, organizationId })
      if (!workspace?.enabled || !workspace.amber_number) {
        return NextResponse.json(
          { error: "Turn Amber on and get an Amber number first." },
          { status: 400 }
        )
      }
      const code = generateAmberVerifyCode()
      await createAmberMobileVerification({
        userId,
        organizationId,
        mobileE164: mobile,
        code,
      })
      const sent = await sendAmberOwnerSms({
        userId,
        organizationId,
        amberNumber: workspace.amber_number,
        toOwnerMobile: mobile,
        text: `Amber · Lyncr code: ${code}. Enter this in Settings to verify your phone.`,
      })
      if (!sent.ok) {
        return NextResponse.json(
          {
            error:
              sent.error ||
              "Could not send verification text. Check carrier SMS registration, then try again.",
          },
          { status: 502 }
        )
      }
      return NextResponse.json({
        data: {
          sent: true,
          mobile,
          used_from: sent.used_from ?? null,
        },
      })
    }

    if (action === "verify_confirm") {
      const mobile = normalizePhoneNumberE164(String(body.mobile || ""))
      const code = String(body.code || "").trim()
      if (!mobile || !code) {
        return NextResponse.json({ error: "Mobile and code are required." }, { status: 400 })
      }
      const ok = await consumeAmberMobileVerification({ userId, mobileE164: mobile, code })
      if (!ok) {
        return NextResponse.json({ error: "Code expired or incorrect." }, { status: 400 })
      }
      await setAmberOwnerMobileVerified({ userId, organizationId, mobileE164: mobile })
      await insertAmberAuditEvent({
        userId,
        organizationId,
        eventType: "mobile_verified",
        detail: { mobile },
      })
      const workspace = await getAmberWorkspace({ userId, organizationId })
      if (workspace?.amber_number) {
        await sendAmberOwnerSms({
          userId,
          organizationId,
          amberNumber: workspace.amber_number,
          toOwnerMobile: mobile,
          text: "Amber is your business assistant by text. Save the Amber number shown in Settings as Amber · Lyncr. Reply HELP for commands.",
        })
      }
      return NextResponse.json({ data: { verified: true, mobile } })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (e) {
    const code = (e as Error & { code?: string }).code
    if (code === "AMBER_MIGRATION_REQUIRED") {
      return NextResponse.json({ error: (e as Error).message, code }, { status: 503 })
    }
    console.error("[POST /api/amber]", e)
    return NextResponse.json({ error: "Amber request failed" }, { status: 500 })
  }
}
