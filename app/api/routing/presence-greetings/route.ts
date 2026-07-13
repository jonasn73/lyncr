// GET/PUT /api/routing/presence-greetings — custom On-Job / Closed IVR Speak scripts.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  DEFAULT_CLOSED_GREETING_TEXT,
  DEFAULT_ON_JOB_GREETING_TEXT,
  getAccountPresence,
  setAccountPresenceGreetings,
} from "@/lib/account-presence"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function pickGreeting(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = body[key]
    if (typeof v === "string") return v
  }
  return undefined
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const presence = await getAccountPresence(userId)
    return NextResponse.json({
      data: {
        onJobGreetingText: presence.onJobGreetingText,
        closedGreetingText: presence.closedGreetingText,
        on_job_greeting_text: presence.onJobGreetingText,
        closed_greeting_text: presence.closedGreetingText,
        defaults: {
          onJobGreetingText: DEFAULT_ON_JOB_GREETING_TEXT,
          closedGreetingText: DEFAULT_CLOSED_GREETING_TEXT,
        },
      },
    })
  } catch (e) {
    console.error("[GET /api/routing/presence-greetings]", e)
    return NextResponse.json({
      data: {
        onJobGreetingText: DEFAULT_ON_JOB_GREETING_TEXT,
        closedGreetingText: DEFAULT_CLOSED_GREETING_TEXT,
        on_job_greeting_text: DEFAULT_ON_JOB_GREETING_TEXT,
        closed_greeting_text: DEFAULT_CLOSED_GREETING_TEXT,
        defaults: {
          onJobGreetingText: DEFAULT_ON_JOB_GREETING_TEXT,
          closedGreetingText: DEFAULT_CLOSED_GREETING_TEXT,
        },
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

  const onJobRaw = pickGreeting(body, [
    "onJobGreetingText",
    "on_job_greeting_text",
    "onJobGreeting",
  ])
  const closedRaw = pickGreeting(body, [
    "closedGreetingText",
    "closed_greeting_text",
    "closedGreeting",
  ])

  // Load existing so partial updates keep the other field.
  const existing = await getAccountPresence(userId)
  const onJob = typeof onJobRaw === "string" ? onJobRaw : existing.onJobGreetingText
  const closed = typeof closedRaw === "string" ? closedRaw : existing.closedGreetingText

  try {
    const saved = await setAccountPresenceGreetings({
      ownerUserId: userId,
      onJobGreetingText: onJob,
      closedGreetingText: closed,
    })
    return NextResponse.json({
      data: {
        onJobGreetingText: saved.onJobGreetingText,
        closedGreetingText: saved.closedGreetingText,
        on_job_greeting_text: saved.onJobGreetingText,
        closed_greeting_text: saved.closedGreetingText,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed"
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : ""
    if (
      code === "PRESENCE_GREETINGS_MIGRATION_REQUIRED" ||
      msg.includes("100-presence-automation-greetings")
    ) {
      return NextResponse.json(
        {
          error: msg,
          migration: "scripts/100-presence-automation-greetings.sql",
        },
        { status: 503 }
      )
    }
    console.error("[PUT /api/routing/presence-greetings]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
