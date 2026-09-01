// GET /api/tech/inventory/[id]/image — serve a captured key photo, scoped to the tech's owner.
//
// key_inventory.image_url always stores /api/inventory/{id}/image (see keyInventoryImagePath in
// lib/key-inventory.ts) regardless of who uploaded it — that owner-only route 404s for a tech
// session, so the tech client builds this URL itself instead of trusting the stored field.

import { NextRequest, NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { getKeyInventoryImageBinary } from "@/lib/key-inventory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req.headers.get("cookie"), { capability: "inventory_control" })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!id?.trim()) return NextResponse.json({ error: "id required" }, { status: 400 })

  try {
    const image = await getKeyInventoryImageBinary(actor.ownerUserId, id.trim())
    if (!image) return NextResponse.json({ error: "No image" }, { status: 404 })

    const bytes = Buffer.from(image.dataBase64, "base64")
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(bytes.length),
      },
    })
  } catch (e) {
    console.error("[tech/inventory/image GET]", e)
    return NextResponse.json({ error: "Could not load image" }, { status: 500 })
  }
}
