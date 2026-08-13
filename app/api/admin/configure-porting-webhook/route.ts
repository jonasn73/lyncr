// Legacy Twilio porting webhook setup — Telnyx uses /api/webhooks/telnyx/porting.

import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Twilio porting webhooks are removed. Point Telnyx Mission Control at /api/webhooks/telnyx/porting.",
    },
    { status: 410 }
  )
}
