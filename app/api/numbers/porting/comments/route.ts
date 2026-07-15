// ============================================
// GET/POST /api/numbers/porting/comments
// ============================================
// Proxies Telnyx porting order comments (same thread as Mission Control → Communications).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  userOwnsTelnyxPortOrder,
  listTelnyxPortingOrderComments,
  createTelnyxPortingOrderComment,
} from "@/lib/telnyx-porting-orders"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const orderId = new URL(req.url).searchParams.get("order_id")?.trim()
  if (!orderId) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 })
  }
  try {
    const ok = await userOwnsTelnyxPortOrder(orderId, userId)
    if (!ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const comments = await listTelnyxPortingOrderComments(orderId)
    const sorted = [...comments].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    return NextResponse.json({ data: { comments: sorted } })
  } catch (e) {
    console.error("[lyncr] GET porting comments:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load comments" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const body = (await req.json()) as { order_id?: string; body?: string }
    const orderId = body?.order_id?.trim()
    const text = body?.body?.trim()
    if (!orderId) {
      return NextResponse.json({ error: "order_id is required" }, { status: 400 })
    }
    if (!text) {
      return NextResponse.json({ error: "body is required" }, { status: 400 })
    }
    if (text.length > 8000) {
      return NextResponse.json({ error: "Message too long" }, { status: 400 })
    }
    const ok = await userOwnsTelnyxPortOrder(orderId, userId)
    if (!ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    await createTelnyxPortingOrderComment(orderId, text)
    return NextResponse.json({ data: { ok: true } })
  } catch (e) {
    console.error("[lyncr] POST porting comments:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to send comment" },
      { status: 500 }
    )
  }
}
