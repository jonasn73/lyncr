// POST /api/support/chat/upload — multipart file → Vercel Blob

import { NextRequest, NextResponse } from "next/server"
import { requireSessionUser } from "@/lib/admin-api-guard"
import {
  SUPPORT_CHAT_MAX_BYTES,
  uploadSupportChatBlob,
} from "@/lib/support-chat-blob"

export async function POST(req: NextRequest) {
  const ctx = await requireSessionUser(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const form = await req.formData()
    const file = form.get("file")
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file. Send multipart form field 'file'." },
        { status: 400 }
      )
    }
    if (file.size > SUPPORT_CHAT_MAX_BYTES) {
      return NextResponse.json({ error: "File is too large (max 10 MB)." }, { status: 400 })
    }

    const uploaded = await uploadSupportChatBlob({
      userId: ctx.userId,
      file,
      filename: file.name || "attachment",
      contentType: file.type || "application/octet-stream",
    })

    return NextResponse.json({ data: uploaded })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed"
    const status = msg.includes("BLOB_READ_WRITE_TOKEN") || msg.includes("not allowed") ? 400 : 500
    console.error("[support/chat/upload]", e)
    return NextResponse.json({ error: msg }, { status })
  }
}
