// GET /api/crm/customers — enriched CRM customer list
import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceActor } from "@/lib/workspace-actor"
import { listCrmCustomersForUser } from "@/lib/db"
import { sanitizeIanaTimezone } from "@/lib/telemetry-timezone"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function GET(req: NextRequest) {
  const actor = await resolveWorkspaceActor(req.headers.get("cookie"), {
    capability: "crm_access",
  })
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = actor.ownerUserId

  const q = req.nextUrl.searchParams.get("q") || ""
  const filterRaw = req.nextUrl.searchParams.get("filter") || "all"
  const filter =
    filterRaw === "leads" ||
    filterRaw === "clients" ||
    filterRaw === "book_forms" ||
    filterRaw === "needs_followup"
      ? filterRaw
      : "all"
  const limit = Number(req.nextUrl.searchParams.get("limit") || "80")
  // Match Activity: format “Booked · …” in the owner’s zone, not Vercel UTC.
  const timeZone = sanitizeIanaTimezone(req.nextUrl.searchParams.get("timezone"))

  try {
    const customers = await listCrmCustomersForUser(userId, { q, filter, limit, timeZone })
    return NextResponse.json({ data: { customers } })
  } catch (e) {
    console.error("[GET /api/crm/customers]", e)
    return NextResponse.json({ error: "Failed to load CRM customers" }, { status: 500 })
  }
}
