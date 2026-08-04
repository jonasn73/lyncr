// GET /api/admin/support-chat/[threadId] — thread + messages (marks admin read)
// POST — admin reply (text + optional attachment URLs)
// PATCH — close/reopen status

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  getSupportChatThreadById,
  getUser,
  insertSupportChatMessage,
  listSupportChatMessages,
  markSupportChatReadByAdmin,
  updateSupportChatThreadStatus,
} from "@/lib/db"
import { sendSupportChatReplyEmail } from "@/lib/support-chat-notify"
import type { SupportChatThreadStatus } from "@/lib/types"

type Ctx = { params: Promise<{ threadId: string }> }

export async function GET(req: NextRequest, context: Ctx) {
  const auth = await requireLyncrAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { threadId } = await context.params
  if (!threadId) {
    return NextResponse.json({ error: "Missing thread id" }, { status: 400 })
  }

  try {
    const thread = await getSupportChatThreadById(threadId)
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    }
    await markSupportChatReadByAdmin(threadId)
    const messages = await listSupportChatMessages(threadId)
    const owner = await getUser(thread.user_id)
    return NextResponse.json({
      data: {
        thread: { ...thread, admin_unread_count: 0 },
        messages,
        owner: owner
          ? {
              id: owner.id,
              name: owner.name,
              email: owner.email,
              business_name: owner.business_name,
              phone: owner.phone,
            }
          : null,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load thread"
    if (msg.includes("128-support-chat")) {
      return NextResponse.json({ error: msg }, { status: 503 })
    }
    console.error("[admin/support-chat/[id] GET]", e)
    return NextResponse.json({ error: "Failed to load thread" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, context: Ctx) {
  const auth = await requireLyncrAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { threadId } = await context.params
  if (!threadId) {
    return NextResponse.json({ error: "Missing thread id" }, { status: 400 })
  }

  try {
    const thread = await getSupportChatThreadById(threadId)
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    }

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
      return NextResponse.json({ error: "Type a reply or attach a file." }, { status: 400 })
    }
    if (text.length > 8000) {
      return NextResponse.json({ error: "Message is too long." }, { status: 400 })
    }

    const message = await insertSupportChatMessage({
      threadId,
      senderType: "admin",
      senderUserId: auth.userId,
      body: text,
      attachments,
    })

    // Notify the tenant by email (best-effort).
    const owner = await getUser(thread.user_id)
    if (owner?.email) {
      const preview =
        text ||
        (attachments[0] ? `Attachment: ${attachments[0].filename}` : "New support reply")
      void sendSupportChatReplyEmail({
        toEmail: owner.email,
        businessName: owner.business_name || "your business",
        preview,
      }).catch((err) => console.error("[admin/support-chat] notify email", err))
    }

    return NextResponse.json({ data: { message } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send"
    if (msg.includes("128-support-chat")) {
      return NextResponse.json({ error: msg }, { status: 503 })
    }
    console.error("[admin/support-chat/[id] POST]", e)
    return NextResponse.json({ error: msg || "Failed to send" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, context: Ctx) {
  const auth = await requireLyncrAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { threadId } = await context.params
  if (!threadId) {
    return NextResponse.json({ error: "Missing thread id" }, { status: 400 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { status?: string; read?: boolean }
    if (body.read === true) {
      await markSupportChatReadByAdmin(threadId)
    }
    if (body.status) {
      const status = String(body.status) as SupportChatThreadStatus
      if (!["open", "waiting", "closed"].includes(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 })
      }
      const updated = await updateSupportChatThreadStatus(threadId, status)
      return NextResponse.json({ data: updated })
    }
    const thread = await getSupportChatThreadById(threadId)
    return NextResponse.json({ data: thread })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update"
    console.error("[admin/support-chat/[id] PATCH]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
