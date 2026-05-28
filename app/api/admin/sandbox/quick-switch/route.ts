// POST /api/admin/sandbox/quick-switch — impersonate test receptionist and return redirect URL.

import { NextRequest, NextResponse } from "next/server"
import {
  createSessionCookie,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  createImpersonationAdminCookie,
  getImpersonationAdminCookieOptions,
  getImpersonationReturnCookieOptions,
  IMPERSONATION_ADMIN_COOKIE,
  IMPERSONATION_RETURN_COOKIE,
  SANDBOX_IMPERSONATION_RETURN_PATH,
} from "@/lib/admin-impersonation"
import {
  resolveSandboxTestReceptionistForSwitch,
  SANDBOX_TEST_RECEPTIONIST_TRAINING_PATH,
} from "@/lib/sandbox-engine"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const resolved = await resolveSandboxTestReceptionistForSwitch()
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: 400 })
    }

    const res = NextResponse.json({
      data: {
        redirect: SANDBOX_TEST_RECEPTIONIST_TRAINING_PATH,
        impersonating: true,
        target_user_id: resolved.target_user_id,
        target_email: resolved.target_email,
      },
    })

    res.cookies.set(
      getSessionCookieName(),
      createSessionCookie(resolved.target_user_id),
      getSessionCookieOptions()
    )
    res.cookies.set(
      IMPERSONATION_ADMIN_COOKIE,
      createImpersonationAdminCookie(ctx.userId),
      getImpersonationAdminCookieOptions()
    )
    res.cookies.set(
      IMPERSONATION_RETURN_COOKIE,
      encodeURIComponent(SANDBOX_IMPERSONATION_RETURN_PATH),
      getImpersonationReturnCookieOptions()
    )

    return res
  } catch (e) {
    console.error("[lyncr-admin] sandbox quick-switch:", e)
    return NextResponse.json({ error: "Quick-switch failed" }, { status: 500 })
  }
}
