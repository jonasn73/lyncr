// POST /api/admin/sync-texml-voice — point Telnyx Call Router at static pass-1 greeting + /incoming pass 2.
import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getOrCreateTexmlApp, getInboundTexmlGreetVoiceUrl, getInboundTexmlRoutingVoiceUrl } from "@/lib/telnyx-config"
import { getOrCreateCallControlApp, getInboundCallControlWebhookUrl } from "@/lib/telnyx-call-control-config"
import { readInboundCallControlEnabled } from "@/lib/telnyx-call-control-inbound"
import { getAppUrl } from "@/lib/telnyx"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const appUrl = getAppUrl()
    const texmlAppId = await getOrCreateTexmlApp()
    const data: Record<string, unknown> = {
      texml_app_id: texmlAppId,
      voice_url: getInboundTexmlGreetVoiceUrl(appUrl),
      voice_method: "GET",
      voice_fallback_url: getInboundTexmlRoutingVoiceUrl(appUrl),
    }
    if (readInboundCallControlEnabled()) {
      const ccAppId = await getOrCreateCallControlApp()
      data.call_control_app_id = ccAppId
      data.call_control_webhook_url = getInboundCallControlWebhookUrl(appUrl)
    }
    return NextResponse.json({ data })
  } catch (error) {
    console.error("[lyncr] sync-texml-voice:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Telnyx sync failed" },
      { status: 500 }
    )
  }
}
