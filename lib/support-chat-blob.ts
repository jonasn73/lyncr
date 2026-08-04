// Upload support-chat files to Vercel Blob (images + common docs).

import { put } from "@vercel/blob"

/** Max upload size: 10 MB. */
export const SUPPORT_CHAT_MAX_BYTES = 10 * 1024 * 1024

/** MIME types we allow for chat attachments. */
export const SUPPORT_CHAT_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
])

/** True when Blob token is present (local .env or Vercel env). */
export function isSupportChatBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim())
}

/** Sanitize a filename for the Blob pathname (keep extension). */
function safeFilename(name: string): string {
  const base = name.replace(/[^\w.\-()+ ]+/g, "_").trim().slice(0, 120)
  return base || "attachment"
}

/**
 * Store one file in Vercel Blob under support-chat/.
 * Requires BLOB_READ_WRITE_TOKEN in the environment.
 */
export async function uploadSupportChatBlob(params: {
  userId: string
  file: File | Blob
  filename: string
  contentType: string
}): Promise<{ url: string; filename: string; contentType: string; sizeBytes: number }> {
  if (!isSupportChatBlobConfigured()) {
    throw new Error(
      "File uploads need BLOB_READ_WRITE_TOKEN. Add it in Vercel → Environment Variables (from Vercel → Storage → Blob), then redeploy."
    )
  }

  const contentType = (params.contentType || "application/octet-stream").toLowerCase()
  if (!SUPPORT_CHAT_ALLOWED_MIME.has(contentType)) {
    throw new Error(
      "That file type is not allowed. Use images (JPEG/PNG/WebP/GIF), PDF, or common Office docs."
    )
  }

  const sizeBytes =
    typeof (params.file as File).size === "number" ? (params.file as File).size : 0
  if (sizeBytes > SUPPORT_CHAT_MAX_BYTES) {
    throw new Error("File is too large (max 10 MB).")
  }
  if (sizeBytes < 1) {
    throw new Error("Empty file.")
  }

  const filename = safeFilename(params.filename)
  const pathname = `support-chat/${params.userId}/${Date.now()}-${filename}`

  const blob = await put(pathname, params.file, {
    access: "public",
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  })

  return {
    url: blob.url,
    filename,
    contentType,
    sizeBytes,
  }
}
