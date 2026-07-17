// GET /api/inventory/[id]/image — serve captured key photo for the signed-in owner.

import { NextRequest, NextResponse } from "next/server" // Next.js request/response helpers
import { getUserIdFromRequest } from "@/lib/auth" // Session cookie → user id
import { getKeyInventoryImageBinary } from "@/lib/key-inventory" // Load base64 + mime from Neon

export const runtime = "nodejs" // Buffer support for binary response
export const dynamic = "force-dynamic" // Always hit the database

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> } // Dynamic route segment
) {
  const userId = getUserIdFromRequest(req.headers.get("cookie")) // Must be signed in
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await ctx.params // Inventory row UUID
  if (!id?.trim()) return NextResponse.json({ error: "id required" }, { status: 400 })

  try {
    const image = await getKeyInventoryImageBinary(userId, id.trim()) // Owner-scoped load
    if (!image) return NextResponse.json({ error: "No image" }, { status: 404 })

    const bytes = Buffer.from(image.dataBase64, "base64") // Decode for the HTTP body
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": image.mimeType, // So <img> knows the format
        "Cache-Control": "private, max-age=3600", // Browser can cache for an hour
        "Content-Length": String(bytes.length),
      },
    })
  } catch (e) {
    console.error("[inventory/image GET]", e)
    return NextResponse.json({ error: "Could not load image" }, { status: 500 })
  }
}
