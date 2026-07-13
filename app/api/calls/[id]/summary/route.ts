// GET /api/calls/[id]/summary — lightweight call row for photo-alert deep links.

import { NextRequest, NextResponse } from "next/server"
import { getSessionUser } from "@/lib/server-session-user"
import { resolveWorkspaceAccountId } from "@/lib/active-operator"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  // Signed-in operator only.
  const user = await getSessionUser()
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // Map receptionist → business OWNER.
  const accountId = await resolveWorkspaceAccountId(user.id)
  const { id } = await ctx.params
  if (!id?.trim()) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 })
  }

  try {
    const sql = neon(resolveNeonDatabaseUrl())
    const rows = await sql`
      SELECT id::text AS id, from_number, to_number, answered_at::text AS answered_at
      FROM call_logs
      WHERE id = ${id}
        AND user_id = ${accountId}
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return NextResponse.json({
      data: {
        id: String(row.id),
        from_number: row.from_number != null ? String(row.from_number) : "",
        to_number: row.to_number != null ? String(row.to_number) : "",
        answered_at: row.answered_at != null ? String(row.answered_at) : null,
      },
    })
  } catch (e) {
    console.error("[GET /api/calls/[id]/summary]", e)
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 })
  }
}
