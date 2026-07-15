import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  deleteAiAssistantPreset,
  getAiAssistantPresets,
  insertAiAssistantPreset,
  updateAiAssistantPreset,
} from "@/lib/db"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const presets = await getAiAssistantPresets(userId)
    return NextResponse.json({ presets })
  } catch (error) {
    console.error("[lyncr] Failed to list AI presets:", error)
    return NextResponse.json({ error: "Failed to load presets" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const body = await req.json()
    const label = String(body?.label || "").trim()
    const config = (body?.config as Record<string, unknown>) || {}
    if (!label) return NextResponse.json({ error: "Preset label is required" }, { status: 400 })

    const preset = await insertAiAssistantPreset({
      user_id: userId,
      label,
      config,
    })
    return NextResponse.json({ preset }, { status: 201 })
  } catch (error) {
    console.error("[lyncr] Failed to create AI preset:", error)
    return NextResponse.json({ error: "Failed to save preset" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const presetId = req.nextUrl.searchParams.get("id") || ""
    if (!presetId) return NextResponse.json({ error: "Preset id is required" }, { status: 400 })

    await deleteAiAssistantPreset(userId, presetId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[lyncr] Failed to delete AI preset:", error)
    return NextResponse.json({ error: "Failed to delete preset" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const body = await req.json()
    const id = String(body?.id || "").trim()
    const label = body?.label !== undefined ? String(body.label).trim() : undefined
    const config = body?.config !== undefined ? (body.config as Record<string, unknown>) : undefined
    if (!id) return NextResponse.json({ error: "Preset id is required" }, { status: 400 })
    if (label !== undefined && !label) {
      return NextResponse.json({ error: "Preset label cannot be empty" }, { status: 400 })
    }

    const preset = await updateAiAssistantPreset({
      user_id: userId,
      id,
      label,
      config,
    })
    if (!preset) return NextResponse.json({ error: "Preset not found" }, { status: 404 })
    return NextResponse.json({ preset })
  } catch (error) {
    console.error("[lyncr] Failed to update AI preset:", error)
    return NextResponse.json({ error: "Failed to update preset" }, { status: 500 })
  }
}
