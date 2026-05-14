// ============================================
// POST /api/feedback
// ============================================
// Authenticated user submits issue / feature / billing feedback.

import { NextRequest, NextResponse } from "next/server"
import { insertFeedbackSubmission } from "@/lib/db"
import { requireSessionUser } from "@/lib/admin-api-guard"
import type { FeedbackCategory } from "@/lib/types"

const CATEGORIES: FeedbackCategory[] = ["issue", "feature", "billing", "other"]

export async function POST(req: NextRequest) {
  const ctx = await requireSessionUser(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const body = await req.json()
    const category = String(body?.category ?? "").trim() as FeedbackCategory
    const subject = String(body?.subject ?? "").trim()
    const text = String(body?.body ?? "").trim()
    if (!CATEGORIES.includes(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 })
    }
    if (subject.length < 3 || subject.length > 200) {
      return NextResponse.json({ error: "Subject must be 3–200 characters" }, { status: 400 })
    }
    if (text.length < 10 || text.length > 8000) {
      return NextResponse.json({ error: "Details must be 10–8000 characters" }, { status: 400 })
    }
    const row = await insertFeedbackSubmission({
      user_id: ctx.userId,
      category,
      subject,
      body: text,
    })
    return NextResponse.json({ data: row })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save feedback"
    if (msg.includes("019-billing-admin-feedback")) {
      return NextResponse.json({ error: msg }, { status: 503 })
    }
    console.error("[Zing] feedback POST:", e)
    return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 })
  }
}
