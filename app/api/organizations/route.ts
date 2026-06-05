// GET  /api/organizations — list workspaces for the signed-in owner
// POST /api/organizations — create another business workspace

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { createOrganizationForOwner, getUser, listOrganizationsForOwner } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can manage workspaces" }, { status: 403 })
  }

  try {
    const organizations = await listOrganizationsForOwner(userId)
    return NextResponse.json({ data: { organizations } })
  } catch (e) {
    console.error("[GET /api/organizations] failed:", e)
    return NextResponse.json({ error: "Could not load workspaces" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can create workspaces" }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { name?: string }
  const name = String(body.name ?? "").trim()
  if (name.length < 2) {
    return NextResponse.json({ error: "Enter a business name (at least 2 characters)" }, { status: 400 })
  }

  try {
    const organization = await createOrganizationForOwner(userId, name)
    const organizations = await listOrganizationsForOwner(userId)
    return NextResponse.json({ data: { organization, organizations } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create workspace"
    console.error("[POST /api/organizations] failed:", e)
    const needsMigration = /organizations|migration|relation.*does not exist/i.test(msg)
    return NextResponse.json(
      { error: needsMigration ? "Run scripts/065-organizations-external-lines.sql in Neon first." : msg },
      { status: needsMigration ? 409 : 500 }
    )
  }
}
