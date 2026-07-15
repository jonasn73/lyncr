// ============================================
// PATCH /api/numbers/[id] — update label / friendly name
// DELETE /api/numbers/[id] — release line back to Telnyx
// ============================================

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { patchPhoneNumberForUser } from "@/lib/db"
import { releasePhoneNumberForUser } from "@/lib/number-release"

const MAX_LINE_LABEL_LEN = 120

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "Missing number id" }, { status: 400 })
  }

  try {
    const result = await releasePhoneNumberForUser(userId, id)
    if (!result.ok) {
      const status =
        result.reason === "not_found"
          ? 404
          : result.reason === "last_line" || result.reason === "porting_line" || result.reason === "not_active"
            ? 409
            : result.reason === "carrier_error"
              ? 502
              : 400
      return NextResponse.json({ error: result.error, reason: result.reason }, { status })
    }

    console.log(`[lyncr] Released ${result.phone_number} for user ${userId}`)
    return NextResponse.json({ data: { ok: true, phone_number: result.phone_number } })
  } catch (error) {
    console.error("[lyncr] DELETE /api/numbers/[id] error:", error)
    return NextResponse.json({ error: "Failed to release number" }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest, // Incoming HTTP request (JSON body)
  { params }: { params: Promise<{ id: string }> } // Dynamic route segment `[id]` (UUID of phone_numbers row)
) {
  const userId = getUserIdFromRequest(req.headers.get("cookie")) // Who is calling — null if not logged in
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 }) // Reject anonymous PATCH
  }
  const { id } = await params // Await because App Router passes params as a Promise
  if (!id) {
    return NextResponse.json({ error: "Missing number id" }, { status: 400 }) // Path must include an id
  }
  try {
    const body = (await req.json()) as Record<string, unknown> // Parse JSON: { label?, friendly_name?, organization_id? }
    const patch: { label?: string; friendly_name?: string; organization_id?: string | null } = {} // Only fields we will send to the DB layer
    if (typeof body?.label === "string") {
      patch.label = body.label.trim().slice(0, MAX_LINE_LABEL_LEN) // Normalize + cap length for safety
    }
    if (typeof body?.friendly_name === "string") {
      patch.friendly_name = body.friendly_name.trim().slice(0, 80) // Optional display form of the DID
    }
    if (body?.organization_id === null) {
      patch.organization_id = null
    } else if (typeof body?.organization_id === "string" && body.organization_id.trim()) {
      patch.organization_id = body.organization_id.trim()
    }
    if (
      patch.label === undefined &&
      patch.friendly_name === undefined &&
      patch.organization_id === undefined
    ) {
      return NextResponse.json({ error: "Provide label, friendly_name, and/or organization_id" }, { status: 400 }) // Nothing to update
    }
    const ok = await patchPhoneNumberForUser(id, userId, patch) // false if id not owned by this user
    if (!ok) {
      return NextResponse.json({ error: "Number not found" }, { status: 404 }) // Wrong id or other account’s row
    }
    return NextResponse.json({ data: { ok: true, ...patch } }) // Client can refresh local state from echoed fields
  } catch (error) {
    console.error("[lyncr] PATCH /api/numbers/[id] error:", error) // Log server-side for debugging
    return NextResponse.json({ error: "Failed to update number" }, { status: 500 }) // Malformed JSON or DB error
  }
}
