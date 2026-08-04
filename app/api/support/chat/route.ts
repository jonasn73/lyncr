// GET /api/support/chat — get or create tenant thread + messages
// POST /api/support/chat — send a text message (optional attachment URLs from upload)

import { NextRequest, NextResponse } from "next/server"
import { requireSessionUser } from "@/lib/admin-api-guard"
import {
  ensureSupportChatWaitingNotice,
  getOrCreateSupportChatThread,
  getSupportChatThreadById,
  insertSupportChatMessage,
  listSupportChatMessages,
  markSupportChatReadByUser,
} from "@/lib/db"

export async function GET(req: NextRequest) {
  const ctx = await requireSessionUser(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const thread = await getOrCreateSupportChatThread(ctx.userId)
    // Empty thread: show the waiting-agent system line right away.
    await ensureSupportChatWaitingNotice(thread.id)
    await markSupportChatReadByUser(thread.id, ctx.userId)
    const messages = await listSupportChatMessages(thread.id)
    const refreshed = (await getSupportChatThreadById(thread.id)) ?? thread
    return NextResponse.json({
      data: {
        thread: { ...refreshed, user_unread_count: 0 },
        messages,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load chat"
    if (msg.includes("128-support-chat")) {
      return NextResponse.json({ error: msg }, { status: 503 })
    }
    console.error("[support/chat GET]", e)
    return NextResponse.json({ error: "Failed to load chat" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireSessionUser(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json().catch(() => ({}))) as {
      body?: string
      attachments?: Array<{
        url?: string
        filename?: string
        content_type?: string
        size_bytes?: number
      }>
    }
    const text = String(body.body ?? "").trim()
    const attachments = (body.attachments ?? [])
      .filter((a) => typeof a?.url === "string" && a.url.startsWith("https://"))
      .map((a) => ({
        url: String(a.url),
        filename: String(a.filename ?? "file").slice(0, 200),
        content_type: String(a.content_type ?? "application/octet-stream").slice(0, 120),
        size_bytes: Math.max(0, Number(a.size_bytes ?? 0)),
      }))

    if (!text && attachments.length === 0) {
      return NextResponse.json({ error: "Type a message or attach a file." }, { status: 400 })
    }
    if (text.length > 8000) {
      return NextResponse.json({ error: "Message is too long (max 8000 characters)." }, { status: 400 })
    }
    if (attachments.length > 5) {
      return NextResponse.json({ error: "Max 5 attachments per message." }, { status: 400 })
    }

    const thread = await getOrCreateSupportChatThread(ctx.userId)
    await ensureSupportChatWaitingNotice(thread.id)

    const message = await insertSupportChatMessage({
      threadId: thread.id,
      senderType: "user",
      senderUserId: ctx.userId,
      body: text,
      attachments,
    })

    return NextResponse.json({ data: { message } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send"
    if (msg.includes("128-support-chat")) {
      return NextResponse.json({ error: msg }, { status: 503 })
    }
    console.error("[support/chat POST]", e)
    return NextResponse.json({ error: msg || "Failed to send" }, { status: 500 })
  }
}
