// ============================================
// GET/POST /api/voice/test-echo
// ============================================
// Self-service audio quality line: greeting → 5s record → playback loop → repeat.
// Point a Telnyx TeXML app or debug DID at this URL to verify call clarity end-to-end.

import { NextRequest, NextResponse } from "next/server"
import { buildTestEchoIntroTexml, buildTestEchoPlaybackTexml } from "@/lib/telnyx-test-echo-texml"

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

async function readFields(req: NextRequest): Promise<Record<string, string>> {
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

async function handleTestEcho(req: NextRequest): Promise<NextResponse> {
  const fields = await readFields(req)
  const phase = (req.nextUrl.searchParams.get("phase") || fields.phase || "").trim().toLowerCase()

  if (phase === "playback") {
    const recordingUrl = pickRecordingUrl(fields)
    const body = buildTestEchoPlaybackTexml(recordingUrl)
    return new NextResponse(body, { headers: { "Content-Type": "text/xml" } })
  }

  const body = buildTestEchoIntroTexml()
  return new NextResponse(body, { headers: { "Content-Type": "text/xml" } })
}

export async function GET(req: NextRequest) {
  return handleTestEcho(req)
}

export async function POST(req: NextRequest) {
  return handleTestEcho(req)
}
