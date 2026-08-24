// ============================================
// GET /api/customers — search list
// PUT /api/customers — upsert one row by phone (autosave from answered-call sheet)
// ============================================

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { resolveIntakeWriteActor } from "@/lib/intake-write-auth"
import {
  listCustomersForUser,
  upsertCustomerForUser,
  getCustomerByPhoneForUser,
  isUndefinedRelationError,
} from "@/lib/db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const q = req.nextUrl.searchParams.get("q") || ""
  const phone = req.nextUrl.searchParams.get("phone") || ""
  const limit = Number(req.nextUrl.searchParams.get("limit") || "80")
  try {
    if (phone.trim()) {
      const one = await getCustomerByPhoneForUser(userId, phone)
      return NextResponse.json({ customers: one ? [one] : [] })
    }
    const customers = await listCustomersForUser(userId, { q, limit })
    return NextResponse.json({ customers })
  } catch (e) {
    console.error("[GET /api/customers]", e)
    return NextResponse.json({ error: "Failed to load customers" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  // Receptionist intake saves the caller as a customer of the business she answers for.
  const actor = await resolveIntakeWriteActor(req.headers.get("cookie"))
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = actor.ownerUserId
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const phone = typeof body.phone_e164 === "string" ? body.phone_e164 : typeof body.phone === "string" ? body.phone : ""
  if (!phone.trim()) {
    return NextResponse.json({ error: "phone_e164 or phone is required" }, { status: 400 })
  }
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : body[k] != null ? String(body[k]) : "")
  const rawSrc = body.source_last_call_log_id
  const sourceLastCallLogId =
    typeof rawSrc === "string" && rawSrc.trim() ? rawSrc.trim() : undefined
  try {
    const customer = await upsertCustomerForUser({
      userId,
      phoneE164: phone,
      displayName: str("display_name"),
      companyName: str("company_name"),
      addressLine1: str("address_line1"),
      addressLine2: str("address_line2"),
      city: str("city"),
      region: str("region"),
      postalCode: str("postal_code"),
      country: str("country") || "US",
      notes: str("notes"),
      sourceLastCallLogId,
    })
    return NextResponse.json({ data: customer })
  } catch (e) {
    if (isUndefinedRelationError(e, "customers")) {
      return NextResponse.json(
        { error: "Customers table missing. Run scripts/022-customers.sql in Neon." },
        { status: 503 }
      )
    }
    console.error("[PUT /api/customers]", e)
    return NextResponse.json({ error: "Could not save customer" }, { status: 500 })
  }
}
