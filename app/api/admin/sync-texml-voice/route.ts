// POST /api/admin/sync-texml-voice — point Telnyx Call Router at static pass-1 greeting + /incoming pass 2.
import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getOrCreateTexmlApp, getInboundTexmlGreetVoiceUrl, getInboundTexmlRoutingVoiceUrl } from "@/lib/telnyx-config"
import { getAppUrl } from "@/lib/telnyx"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const appUrl = getAppUrl()
    const appId = await getOrCreateTexmlApp()
    return NextResponse.json({
      data: {
        texml_app_id: appId,
        voice_url: getInboundTexmlGreetVoiceUrl(appUrl),
        voice_method: "GET",
        voice_fallback_url: getInboundTexmlRoutingVoiceUrl(appUrl),
      },
    })
  } catch (error) {
    console.error("[Sigo] sync-texml-voice:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Telnyx sync failed" },
      { status: 500 }
    )
  }
}
