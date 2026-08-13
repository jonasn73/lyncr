// Legacy Twilio Documents upload — ports now go through Telnyx LNP (`POST /api/numbers/port`).

import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json(
    {
      error: "Twilio document upload is removed. Upload the bill on POST /api/numbers/port (invoice_base64).",
    },
    { status: 410 }
  )
}
