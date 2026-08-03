// GET /api/crm/customers — enriched CRM customer list
import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listCrmCustomersForUser } from "@/lib/db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const q = req.nextUrl.searchParams.get("q") || ""
  const filterRaw = req.nextUrl.searchParams.get("filter") || "all"
  const filter =
    filterRaw === "leads" || filterRaw === "clients" || filterRaw === "book_forms"
      ? filterRaw
      : "all"
  const limit = Number(req.nextUrl.searchParams.get("limit") || "80")

  try {
    const customers = await listCrmCustomersForUser(userId, { q, filter, limit })
    return NextResponse.json({ data: { customers } })
  } catch (e) {
    console.error("[GET /api/crm/customers]", e)
    return NextResponse.json({ error: "Failed to load CRM customers" }, { status: 500 })
  }
}
