// GET/POST /api/auth/onboard — public operator onboarding wizard (token-gated).

import { NextRequest, NextResponse } from "next/server"
import {
  createSessionCookie,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth"
import {
  activateOperatorFromSmsInvite,
  getOperatorInviteByToken,
  markOperatorDeviceTesting,
  sendOperatorOnboardingOtp,
  verifyOperatorOtpAndActivate,
} from "@/lib/operator-onboarding"

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim()
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 })
  }

  try {
    const preview = await getOperatorInviteByToken(token)
    if (!preview) {
      return NextResponse.json({ error: "Invite link is invalid or expired." }, { status: 400 })
    }
    return NextResponse.json({
      data: {
        valid: true,
        email: preview.email,
        phone: preview.phone,
        name: preview.name,
        timezone: preview.timezone,
        status: preview.status,
        assigned_workspaces: preview.assignedWorkspaces,
        phone_verified_by_sms_invite: preview.phoneVerifiedBySmsInvite,
      },
    })
  } catch (e) {
    console.error("[auth/onboard GET]", e)
    return NextResponse.json({ error: "Could not validate invite." }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = String(body.action ?? "").trim()
    const token = String(body.token ?? "").trim()

    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 })
    }

    if (action === "device-tested") {
      const ok = await markOperatorDeviceTesting(token)
      if (!ok) return NextResponse.json({ error: "Invite link is invalid or expired." }, { status: 400 })
      return NextResponse.json({ data: { status: "DEVICE_TESTING" } })
    }

    if (action === "send-otp") {
      const backupPhone = String(body.phone ?? body.backup_phone ?? "").trim()
      const result = await sendOperatorOnboardingOtp({ token, backupPhone })
      return NextResponse.json({
        data: {
          sent: result.sent,
          phone: result.normalizedPhone,
          dev_code: result.devCode,
        },
      })
    }

    if (action === "verify-otp") {
      const code = String(body.code ?? body.otp ?? "").trim()
      const password = String(body.password ?? "")
      const name = String(body.name ?? "").trim() || undefined
      const preferWebRouting = Boolean(body.prefer_web_routing ?? body.micTestPassed)

      const activated = await verifyOperatorOtpAndActivate({
        token,
        code,
        password,
        name,
        preferWebRouting,
      })

      const cookieValue = createSessionCookie(activated.userId)
      const res = NextResponse.json({
        data: {
          status: "ACTIVE_READY",
          user_id: activated.userId,
          email: activated.email,
          redirect: "/receptionist",
        },
      })
      res.cookies.set(getSessionCookieName(), cookieValue, getSessionCookieOptions())
      return res
    }

    if (action === "activate") {
      const password = String(body.password ?? "")
      const name = String(body.name ?? "").trim() || undefined
      const preferWebRouting = Boolean(body.prefer_web_routing ?? body.micTestPassed)

      const activated = await activateOperatorFromSmsInvite({
        token,
        password,
        name,
        preferWebRouting,
      })

      const cookieValue = createSessionCookie(activated.userId)
      const res = NextResponse.json({
        data: {
          status: "ACTIVE_READY",
          user_id: activated.userId,
          email: activated.email,
          redirect: "/receptionist",
        },
      })
      res.cookies.set(getSessionCookieName(), cookieValue, getSessionCookieOptions())
      return res
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 })
  } catch (e) {
    console.error("[auth/onboard POST]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Onboarding step failed." },
      { status: 400 }
    )
  }
}
