// GET/PUT /api/routing/ivr — dashboard-controlled traditional IVR greeting + digit actions.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { normalizePhoneNumberE164 } from "@/lib/db"
import {
  DEFAULT_IVR_MENU_SETTINGS,
  normalizeIvrMenuAction,
  normalizeIvrMenuSettings,
  type IvrMenuAction,
} from "@/lib/ivr-menu-settings"
import { getIvrMenuSettingsForOwnerLine, upsertIvrMenuSettings } from "@/lib/ivr-menu-db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const numberParam = req.nextUrl.searchParams.get("number")?.trim() || null
  const businessNumber = numberParam ? normalizePhoneNumberE164(numberParam) : null

  try {
    const settings = await getIvrMenuSettingsForOwnerLine(userId, businessNumber)
    return NextResponse.json({ data: settings })
  } catch (e) {
    console.error("[GET /api/routing/ivr]", e)
    return NextResponse.json({ data: { ...DEFAULT_IVR_MENU_SETTINGS } })
  }
}

export async function PUT(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const numberRaw =
    (typeof body.business_number === "string" && body.business_number) ||
    (typeof body.number === "string" && body.number) ||
    req.nextUrl.searchParams.get("number") ||
    null
  const businessNumber = numberRaw ? normalizePhoneNumberE164(numberRaw) : null

  const settings = normalizeIvrMenuSettings({
    ivrGreetingText: typeof body.ivrGreetingText === "string" ? body.ivrGreetingText : undefined,
    ivrOption1Action: body.ivrOption1Action as IvrMenuAction | undefined,
    ivrOption2Action: body.ivrOption2Action as IvrMenuAction | undefined,
  })

  // Re-normalize actions from body explicitly so invalid values don't silently stick.
  settings.ivrOption1Action = normalizeIvrMenuAction(body.ivrOption1Action, settings.ivrOption1Action)
  settings.ivrOption2Action = normalizeIvrMenuAction(body.ivrOption2Action, settings.ivrOption2Action)

  try {
    const saved = await upsertIvrMenuSettings({
      ownerUserId: userId,
      businessNumber,
      settings,
    })
    return NextResponse.json({ data: saved })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed"
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : ""
    if (code === "IVR_MIGRATION_REQUIRED" || msg.includes("086-ivr-menu-settings")) {
      return NextResponse.json(
        {
          error: msg,
          migration: "scripts/086-ivr-menu-settings.sql",
        },
        { status: 503 }
      )
    }
    console.error("[PUT /api/routing/ivr]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
