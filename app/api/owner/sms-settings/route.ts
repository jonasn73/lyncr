// ============================================
// GET / PUT /api/owner/sms-settings
// ============================================
// Owner reads + saves their Lyncr Automated SMS Engine config (per-phase toggles, custom templates,
// and the review link). Used by the Settings tab.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getOwnerSmsSettings, getUser, normalizeOwnerSmsSnippets, updateOwnerSmsSettings } from "@/lib/db"
import { normalizeSmsStatusTemplates } from "@/lib/sms-status-templates"
import type { OwnerSmsSettings } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const settings = await getOwnerSmsSettings(userId)
    return NextResponse.json({ data: settings })
  } catch (e) {
    console.error("[GET /api/owner/sms-settings] failed:", e)
    return NextResponse.json({ error: "Could not load settings" }, { status: 500 })
  }
}

const TEXT_LIMIT = 480

function clampTemplate(v: unknown): string | null {
  if (v === null) return null
  if (typeof v !== "string") return undefined as unknown as null
  return v.slice(0, TEXT_LIMIT)
}

export async function PUT(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<OwnerSmsSettings>
  const updates: Partial<OwnerSmsSettings> = {}

  if (typeof body.sms_booking_enabled === "boolean") updates.sms_booking_enabled = body.sms_booking_enabled
  if (typeof body.sms_route_enabled === "boolean") updates.sms_route_enabled = body.sms_route_enabled
  if (typeof body.sms_review_enabled === "boolean") updates.sms_review_enabled = body.sms_review_enabled
  if (body.sms_booking_template !== undefined) updates.sms_booking_template = clampTemplate(body.sms_booking_template)
  if (body.sms_route_template !== undefined) updates.sms_route_template = clampTemplate(body.sms_route_template)
  if (body.sms_review_template !== undefined) updates.sms_review_template = clampTemplate(body.sms_review_template)
  if (body.google_review_url !== undefined) {
    updates.google_review_url =
      typeof body.google_review_url === "string" ? body.google_review_url.trim().slice(0, 500) || null : null
  }
  if (body.sms_custom_snippets !== undefined) {
    updates.sms_custom_snippets = normalizeOwnerSmsSnippets(body.sms_custom_snippets)
  }
  if (body.sms_status_templates !== undefined) {
    updates.sms_status_templates = normalizeSmsStatusTemplates(body.sms_status_templates)
  }

  try {
    const settings = await updateOwnerSmsSettings(userId, updates)
    return NextResponse.json({ data: settings })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save settings"
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : ""
    if (code === "SMS_STATUS_MIGRATION_REQUIRED" || msg.includes("118-sms-status-templates")) {
      return NextResponse.json(
        { error: msg, migration: "scripts/118-sms-status-templates.sql" },
        { status: 503 }
      )
    }
    if (code === "SMS_SNIPPETS_MIGRATION_REQUIRED" || msg.includes("117-sms-custom-snippets")) {
      return NextResponse.json(
        { error: msg, migration: "scripts/117-sms-custom-snippets.sql" },
        { status: 503 }
      )
    }
    console.error("[PUT /api/owner/sms-settings] failed:", e)
    return NextResponse.json({ error: "Could not save settings" }, { status: 500 })
  }
}
