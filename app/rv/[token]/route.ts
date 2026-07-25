// GET /rv/{token} — tracked review link → record click → redirect to Google (or owner URL).

import { NextRequest, NextResponse } from "next/server"
import { resolveAndClickReviewToken } from "@/lib/review-link-token"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ token: string }> }

export async function GET(_req: NextRequest, context: RouteContext) {
  const { token } = await context.params
  const dest = await resolveAndClickReviewToken(token || "")
  if (!dest) {
    return NextResponse.redirect(new URL("https://www.google.com/maps"), 302)
  }
  // Only allow http(s) destinations.
  if (!/^https?:\/\//i.test(dest)) {
    return NextResponse.redirect(new URL("https://www.google.com/maps"), 302)
  }
  return NextResponse.redirect(dest, 302)
}
