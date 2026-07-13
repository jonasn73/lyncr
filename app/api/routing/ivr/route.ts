// GET/PUT /api/routing/ivr — dashboard-controlled traditional IVR greeting + digit actions + Off-duty switch.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { normalizePhoneNumberE164 } from "@/lib/db"
import {
  DEFAULT_IVR_MENU_SETTINGS,
  normalizeIvrMenuAction,
  type IvrMenuSettings,
} from "@/lib/ivr-menu-settings"
import { getIvrMenuSettingsForOwnerLine, upsertIvrMenuSettings } from "@/lib/ivr-menu-db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function pickString(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = body[key]
    if (typeof v === "string") return v
  }
  return undefined
}

function bodyHasKey(body: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((k) => k in body)
}

/** Merge PUT body (camelCase + snake_case aliases) onto existing row so partial updates work. */
function mergeIvrPutBody(
  existing: IvrMenuSettings,
  body: Record<string, unknown>
): IvrMenuSettings {
  const greetingRaw = pickString(body, [
    "ivrGreetingText",
    "ivrGreeting",
    "ivr_greeting_text",
    "ivr_greeting",
  ])
  const digit1Raw = body.ivrOption1Action ?? body.digit1Action ?? body.ivr_option1_action ?? body.digit_1_action
  const digit2Raw = body.ivrOption2Action ?? body.digit2Action ?? body.ivr_option2_action ?? body.digit_2_action

  const hasEnabled = bodyHasKey(body, ["ivrMenuEnabled", "ivr_menu_enabled"])
  const enabledRaw = body.ivrMenuEnabled ?? body.ivr_menu_enabled

  return {
    ivrGreetingText:
      typeof greetingRaw === "string" && greetingRaw.trim()
        ? greetingRaw.trim()
        : existing.ivrGreetingText,
    ivrOption1Action: bodyHasKey(body, [
      "ivrOption1Action",
      "digit1Action",
      "ivr_option1_action",
      "digit_1_action",
    ])
      ? normalizeIvrMenuAction(digit1Raw, existing.ivrOption1Action)
      : existing.ivrOption1Action,
    ivrOption2Action: bodyHasKey(body, [
      "ivrOption2Action",
      "digit2Action",
      "ivr_option2_action",
      "digit_2_action",
    ])
      ? normalizeIvrMenuAction(digit2Raw, existing.ivrOption2Action)
      : existing.ivrOption2Action,
    ivrMenuEnabled: hasEnabled
      ? enabledRaw === true ||
        enabledRaw === "true" ||
        enabledRaw === "t" ||
        enabledRaw === "1"
      : existing.ivrMenuEnabled,
  }
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const numberParam = req.nextUrl.searchParams.get("number")?.trim() || null
  const businessNumber = numberParam ? normalizePhoneNumberE164(numberParam) : null

  try {
    const settings = await getIvrMenuSettingsForOwnerLine(userId, businessNumber)
    return NextResponse.json({
      data: {
        ...settings,
        // Snake_case aliases for dashboard / integrations.
        ivr_greeting: settings.ivrGreetingText,
        digit_1_action: settings.ivrOption1Action,
        digit_2_action: settings.ivrOption2Action,
        ivr_menu_enabled: settings.ivrMenuEnabled,
      },
    })
  } catch (e) {
    console.error("[GET /api/routing/ivr]", e)
    return NextResponse.json({
      data: {
        ...DEFAULT_IVR_MENU_SETTINGS,
        ivr_greeting: DEFAULT_IVR_MENU_SETTINGS.ivrGreetingText,
        digit_1_action: DEFAULT_IVR_MENU_SETTINGS.ivrOption1Action,
        digit_2_action: DEFAULT_IVR_MENU_SETTINGS.ivrOption2Action,
        ivr_menu_enabled: false,
      },
    })
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

  try {
    const existing = await getIvrMenuSettingsForOwnerLine(userId, businessNumber)
    const settings = mergeIvrPutBody(existing, body)

    const saved = await upsertIvrMenuSettings({
      ownerUserId: userId,
      businessNumber,
      settings,
    })
    return NextResponse.json({
      data: {
        ...saved,
        ivr_greeting: saved.ivrGreetingText,
        digit_1_action: saved.ivrOption1Action,
        digit_2_action: saved.ivrOption2Action,
        ivr_menu_enabled: saved.ivrMenuEnabled,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed"
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : ""
    if (
      code === "IVR_MIGRATION_REQUIRED" ||
      msg.includes("086-ivr-menu-settings") ||
      msg.includes("087-ivr-menu-enabled")
    ) {
      return NextResponse.json(
        {
          error: msg,
          migration: "scripts/086-ivr-menu-settings.sql + scripts/087-ivr-menu-enabled.sql",
        },
        { status: 503 }
      )
    }
    console.error("[PUT /api/routing/ivr]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
