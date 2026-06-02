// ============================================
// GET/POST /api/admin/network-agents
// ============================================
// Super-admin only (admin@lyncr.app). Lists and creates shared "Global Lyncr Network
// Agents" — rows in `receptionists` with user_id = NULL that any business can route to
// via the hybrid pool (routing_strategy = lyncr_only / hybrid_fallback).
//
// Requires migration 048 (receptionists.user_id must be NULLABLE) to create agents.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  insertGlobalNetworkReceptionist,
  isReasonablePstnDialString,
  listGlobalNetworkReceptionists,
  normalizePhoneNumberE164,
  setReceptionistSipCredential,
} from "@/lib/db"
import { normalizeRoutingPoolSkillTag } from "@/lib/routing-pool-skills"
import { provisionTelnyxSipCredential } from "@/lib/telnyx-sip-provisioning"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const agents = await listGlobalNetworkReceptionists()
    return NextResponse.json({ data: { agents } })
  } catch (error) {
    console.error("[admin/network-agents] GET:", error)
    return NextResponse.json({ error: "Failed to load network agents" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string
      phone?: string
      skills?: unknown
    }

    const name = String(body.name ?? "").trim()
    if (name.length < 2) {
      return NextResponse.json({ error: "Name is required (min 2 characters)." }, { status: 400 })
    }

    const phone = normalizePhoneNumberE164(String(body.phone ?? "").trim())
    if (!isReasonablePstnDialString(phone)) {
      return NextResponse.json({ error: "A valid phone number is required." }, { status: 400 })
    }

    // skills can arrive as an array (possibly with comma-joined entries) or a comma-separated string.
    // Split every entry on commas and slugify so custom tags ("Auto Detailing") become canonical
    // slugs ("auto_detailing") that match a line's normalized industry_tag.
    const rawSkills = Array.isArray(body.skills)
      ? body.skills
      : typeof body.skills === "string"
        ? [body.skills]
        : []
    const skills = Array.from(
      new Set(
        rawSkills
          .flatMap((s) => String(s).split(","))
          .map((s) => normalizeRoutingPoolSkillTag(s))
          .filter(Boolean)
      )
    )

    const agent = await insertGlobalNetworkReceptionist({ name, phone, skills })

    // Automatically provision a unique Telnyx SIP credential so this agent can answer in-browser
    // (WebRTC) with zero manual setup. Best-effort: if Telnyx provisioning isn't configured yet,
    // the agent is still created and simply answers on their cell (CELL) until it is.
    let sip_username: string | null = null
    const provision = await provisionTelnyxSipCredential({ label: `lyncr-agent-${agent.id}` })
    if (provision.status === "provisioned") {
      await setReceptionistSipCredential(agent.id, {
        sipUsername: provision.sipUsername,
        credentialId: provision.credentialId,
      })
      sip_username = provision.sipUsername
    } else {
      console.warn("[admin/network-agents] SIP provisioning skipped:", provision.reason)
    }

    return NextResponse.json({ data: { agent: { ...agent, sip_username } } }, { status: 201 })
  } catch (error) {
    // 23502 = NOT NULL violation → migration 048 (ALTER user_id DROP NOT NULL) hasn't run yet.
    const message = error instanceof Error ? error.message : String(error)
    const needsMigration = message.includes("null value") && message.includes("user_id")
    console.error("[admin/network-agents] POST:", error)
    return NextResponse.json(
      {
        error: needsMigration
          ? "Run migration 048-hybrid-network-fields.sql in Neon first (receptionists.user_id must allow NULL)."
          : "Failed to create network agent.",
      },
      { status: needsMigration ? 409 : 500 }
    )
  }
}
