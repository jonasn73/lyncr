// GET /api/voice/hold-music-debug — admin probe for Busy hold music URLs / inline audio.
// Open while logged in as Lyncr admin. Does not place a call — proves assets are fetchable.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { loadHoldMusicPlaybackContentBase64 } from "@/lib/hold-inline-audio"
import {
  HOLD_MUSIC_DEFAULT_PATH,
  holdMusicMediaName,
  resolveHoldMusicUrlCandidates,
} from "@/lib/hold-queue"
import { getAppUrl } from "@/lib/telnyx"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const appUrl = getAppUrl().replace(/\/$/, "")
  const candidates = resolveHoldMusicUrlCandidates(null)
  const mediaName = holdMusicMediaName()
  const inline = loadHoldMusicPlaybackContentBase64()

  const probes: Array<Record<string, unknown>> = []
  for (const url of candidates.slice(0, 5)) {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "follow" })
      probes.push({
        url,
        status: res.status,
        contentType: res.headers.get("content-type"),
        contentLength: res.headers.get("content-length"),
      })
    } catch (e) {
      probes.push({ url, error: String(e) })
    }
  }

  return NextResponse.json({
    data: {
      appUrl,
      defaultPath: HOLD_MUSIC_DEFAULT_PATH,
      mediaName,
      inlinePlaybackContentChars: inline?.length ?? 0,
      candidates,
      probes,
      howToVerifyLiveCall: [
        "Set Lines to Busy, call the business number, stay on the line (do not hang up during greeting).",
        "In Vercel logs look for telnyx-cc-hold-music-started with mode playback_start+gather (or playback_content).",
        "If you only see gatherStatus=call_hangup then hangup-as-hold — stay on the line past the Busy greeting.",
      ],
    },
  })
}
