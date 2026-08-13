// Legacy Twilio port-in webhook — Telnyx uses /api/webhooks/telnyx/porting.

import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json(
    {
      error: "Twilio porting webhooks are removed. Use POST /api/webhooks/telnyx/porting.",
    },
    { status: 410 }
  )
}
