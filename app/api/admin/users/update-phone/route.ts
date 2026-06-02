// PATCH /api/admin/users/update-phone — operator-only (admin@lyncr.app).
//
// Body: { userId, newPhone }
// Updates the phone in BOTH the users row and any linked receptionists row in a single atomic
// SQL transaction (native parameterized queries) so the two stay perfectly mirrored.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { adminUpdateUserPhone, isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"

export async function PATCH(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const userId = String(body.userId ?? "").trim()
    const newPhone = String(body.newPhone ?? "").trim()

    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })
    if (!newPhone) return NextResponse.json({ error: "Enter a phone number" }, { status: 400 })

    const normalized = normalizePhoneNumberE164(newPhone)
    if (!isReasonablePstnDialString(normalized)) {
      return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 })
    }

    const { phone } = await adminUpdateUserPhone(userId, newPhone)
    return NextResponse.json({ data: { userId, phone } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update phone"
    if (msg.includes("User not found")) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    console.error("[lyncr-admin] update-phone:", e)
    return NextResponse.json({ error: "Failed to update phone" }, { status: 500 })
  }
}
