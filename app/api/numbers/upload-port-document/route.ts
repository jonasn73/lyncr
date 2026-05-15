// ============================================
// POST /api/numbers/upload-port-document
// ============================================
// Uploads a utility bill to the carrier documents API for use in a Port In request.
// Accepts multipart form with field "file" (PDF or image, max 10MB).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { uploadLegacyUtilityBill } from "@/lib/legacy-porting-provider"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get("file")
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file. Send a multipart form with field 'file' (PDF or image, max 10MB)." },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const mimeType = file.type || "application/pdf"
    const filename = file.name || "utility-bill.pdf"

    const documentSid = await uploadLegacyUtilityBill(buffer, filename, mimeType)
    return NextResponse.json({ document_sid: documentSid })
  } catch (error) {
    console.error("[Sigo] Upload port document error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    )
  }
}
