// ============================================
// GET/POST /api/voice/test-echo
// ============================================
// a) POST + JSON + session → outbound Telnyx dial to forwarding_phone_number
// b) GET/POST from Telnyx → TeXML intro → record 5s → playback twice → hangup

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { buildTestEchoIntroTexml, buildTestEchoPlaybackTexml } from "@/lib/telnyx-test-echo-texml"
import { initiateTestEchoForUser } from "@/lib/test-echo-initiate"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

function pickRecordingUrl(fields: Record<string, string>): string {
  return (
    fields.RecordingUrl?.trim() ||
    fields.RecordingURL?.trim() ||
    fields.recording_url?.trim() ||
    ""
  )
}

async function readWebhookFields(req: NextRequest): Promise<Record<string, string>> {
  if (req.method === "GET") {
    const out: Record<string, string> = {}
    req.nextUrl.searchParams.forEach((v, k) => {
      out[k] = v
    })
    return out
  }

  const contentType = (req.headers.get("content-type") || "").toLowerCase()
  if (contentType.includes("application/json")) {
    try {
      const body = (await req.json()) as Record<string, unknown>
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(body)) {
        if (v != null && typeof v !== "object") out[k] = String(v)
      }
      return out
    } catch {
      return {}
    }
  }

  try {
    const formData = await req.formData()
    const out: Record<string, string> = {}
    formData.forEach((v, k) => {
      out[k] = String(v)
    })
    return out
  } catch {
    return {}
  }
}

async function handleTestEchoTexml(req: NextRequest): Promise<NextResponse> {
  const fields = await readWebhookFields(req)
  const phase = (req.nextUrl.searchParams.get("phase") || fields.phase || "").trim().toLowerCase()

  if (phase === "playback") {
    const recordingUrl = pickRecordingUrl(fields)
    const body = buildTestEchoPlaybackTexml(recordingUrl)
    return new NextResponse(body, { headers: { "Content-Type": "text/xml" } })
  }

  const body = buildTestEchoIntroTexml()
  return new NextResponse(body, { headers: { "Content-Type": "text/xml" } })
}

async function handleDashboardInitiate(req: NextRequest, userId: string): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => ({}))) as { business_number?: string }
    const result = await initiateTestEchoForUser(userId, body.business_number)
    return NextResponse.json({ data: result })
  } catch (e) {
    console.error("[voice/test-echo] dashboard initiate", e)
    const msg = e instanceof Error ? e.message : "Could not start audio diagnostics call"
    const status = msg.includes("Settings") || msg.includes("Activate") ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}

export async function GET(req: NextRequest) {
  return handleTestEchoTexml(req)
}

export async function POST(req: NextRequest) {
  const contentType = (req.headers.get("content-type") || "").toLowerCase()

  if (contentType.includes("application/json")) {
    const userId = getUserIdFromRequest(req.headers.get("cookie"))
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }
    return handleDashboardInitiate(req, userId)
  }

  return handleTestEchoTexml(req)
}
