// ============================================
// GET/PUT /api/team/instructions
// ============================================
// Owner-authored "Lyncr Network Instructions" shown to the live operators answering this business's
// calls (business hours, pricing scripts, greeting, what to collect). Stored on
// onboarding_profiles.routing_instructions (scripts/055), read/written defensively.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getRoutingInstructions, setRoutingInstructions } from "@/lib/db"

export const dynamic = "force-dynamic"

/** Generous cap so an owner can paste a full script, but not unbounded. */
const MAX_INSTRUCTIONS_LENGTH = 8000

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const instructions = await getRoutingInstructions(userId)
    return NextResponse.json({ data: { routing_instructions: instructions ?? "" } })
  } catch (e) {
    console.error("[team/instructions GET]", e)
    return NextResponse.json({ error: "Failed to load instructions" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const raw = body.routing_instructions
    const text = typeof raw === "string" ? raw : ""
    if (text.length > MAX_INSTRUCTIONS_LENGTH) {
      return NextResponse.json(
        { error: `Instructions must be ${MAX_INSTRUCTIONS_LENGTH.toLocaleString()} characters or fewer.` },
        { status: 400 }
      )
    }
    const saved = await setRoutingInstructions(userId, text)
    return NextResponse.json({ data: { routing_instructions: saved } })
  } catch (e) {
    console.error("[team/instructions PUT]", e)
    const msg = e instanceof Error ? e.message : "Failed to save instructions"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
