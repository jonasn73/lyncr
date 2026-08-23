// ============================================
// GET /api/admin/tools/amber-preview?email=owner@example.com
// ============================================
// Admin-only, read-only preview of what Amber would text back for a business's
// Q&A topics and morning-greeting snapshot. Never sends a real SMS — this only
// calls the same pure answerAmberQa()/buildAmberDailySnapshotLine() functions
// the live SMS handler uses, so testing here can never cost a real text message.

import { NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getAnyEnabledAmberWorkspaceForOwner } from "@/lib/amber-db"
import { answerAmberQa, buildAmberDailySnapshotLine } from "@/lib/amber-qa"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase()
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 })
  }

  try {
    const sql = neon(resolveNeonDatabaseUrl())
    const rows = await sql`
      SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1
    `
    const userId = (rows[0] as { id?: string } | undefined)?.id
    if (!userId) {
      return NextResponse.json({ error: "No user with that email" }, { status: 404 })
    }

    const amber = await getAnyEnabledAmberWorkspaceForOwner(userId)
    if (!amber) {
      return NextResponse.json(
        { error: "This business has no enabled + verified Amber workspace" },
        { status: 404 }
      )
    }

    const [revenue, missedCalls, nextJob, snapshot] = await Promise.all([
      answerAmberQa({ topic: "revenue", amber }),
      answerAmberQa({ topic: "missed_calls", amber }),
      answerAmberQa({ topic: "next_job", amber }),
      buildAmberDailySnapshotLine(amber),
    ])

    return NextResponse.json({
      data: {
        ownerMobileLast4: amber.owner_mobile_e164?.slice(-4) ?? null,
        timezone: amber.timezone,
        revenue,
        missedCalls,
        nextJob,
        snapshot,
      },
    })
  } catch (e) {
    console.error("[admin/tools/amber-preview] GET:", e)
    return NextResponse.json({ error: "Could not build the Amber preview" }, { status: 500 })
  }
}
