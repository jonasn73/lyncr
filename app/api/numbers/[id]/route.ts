// ============================================
// PATCH /api/numbers/[id]
// ============================================
// Updates metadata for one owned business number (label shown in whisper / UI). Session required.

import { NextRequest, NextResponse } from "next/server" // Next.js request/response helpers for API routes
import { getUserIdFromRequest } from "@/lib/auth" // Reads signed-in user id from the session cookie header
import { patchPhoneNumberForUser } from "@/lib/db" // Runs the UPDATE on phone_numbers for that owner

const MAX_LINE_LABEL_LEN = 120 // Keeps whisper phrases and UI rows from storing huge strings

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
    const body = (await req.json()) as Record<string, unknown> // Parse JSON: { label?, friendly_name? }
    const patch: { label?: string; friendly_name?: string } = {} // Only fields we will send to the DB layer
    if (typeof body?.label === "string") {
      patch.label = body.label.trim().slice(0, MAX_LINE_LABEL_LEN) // Normalize + cap length for safety
    }
    if (typeof body?.friendly_name === "string") {
      patch.friendly_name = body.friendly_name.trim().slice(0, 80) // Optional display form of the DID
    }
    if (patch.label === undefined && patch.friendly_name === undefined) {
      return NextResponse.json({ error: "Provide label and/or friendly_name" }, { status: 400 }) // Nothing to update
    }
    const ok = await patchPhoneNumberForUser(id, userId, patch) // false if id not owned by this user
    if (!ok) {
      return NextResponse.json({ error: "Number not found" }, { status: 404 }) // Wrong id or other account’s row
    }
    return NextResponse.json({ data: { ok: true, ...patch } }) // Client can refresh local state from echoed fields
  } catch (error) {
    console.error("[Zing] PATCH /api/numbers/[id] error:", error) // Log server-side for debugging
    return NextResponse.json({ error: "Failed to update number" }, { status: 500 }) // Malformed JSON or DB error
  }
}
