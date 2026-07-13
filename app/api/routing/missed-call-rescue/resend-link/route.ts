// POST /api/routing/missed-call-rescue/resend-link — operator re-texts the booking link.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser, normalizePhoneNumberE164 } from "@/lib/db"
import { toE164 } from "@/lib/phone-e164"
import { sendMissedCallRescueBookingLink } from "@/lib/missed-call-rescue"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const user = await getUser(userId)
  if (!user || user.account_role !== "owner") {
    return NextResponse.json({ error: "Only owners can resend rescue links" }, { status: 403 })
  }

  let body: { phone_number?: string; business_line?: string | null } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const phoneRaw = typeof body.phone_number === "string" ? body.phone_number.trim() : ""
  const phone = phoneRaw ? normalizePhoneNumberE164(phoneRaw) || toE164(phoneRaw) : ""
  if (!phone) {
    return NextResponse.json({ error: "phone_number is required" }, { status: 400 })
  }

  const lineRaw = typeof body.business_line === "string" ? body.business_line.trim() : ""
  const businessLine = lineRaw
    ? normalizePhoneNumberE164(lineRaw) || toE164(lineRaw) || lineRaw
    : null

  const result = await sendMissedCallRescueBookingLink({
    ownerUserId: userId,
    customerPhone: phone,
    businessLine,
    source: "missed_call_rescue_resend",
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Could not send SMS" },
      { status: 502 }
    )
  }

  return NextResponse.json({ data: { sent: true } })
}
