// POST /api/messaging/10dlc/register — save the draft, then start the pass-through
// Stripe checkout for the carrier registration fee. Returns the Stripe URL to redirect to.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  saveMessaging10DlcDraft,
  createMessaging10DlcCheckout,
  type TenDlcDraftInput,
} from "@/lib/messaging-10dlc"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<TenDlcDraftInput>
    const saved = await saveMessaging10DlcDraft(userId, body as TenDlcDraftInput)
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: 400 })
    }
    const checkout = await createMessaging10DlcCheckout(userId)
    if (!checkout.ok) {
      return NextResponse.json({ error: checkout.error }, { status: 400 })
    }
    return NextResponse.json({
      data: { registration: saved.registration, checkout_url: checkout.url },
    })
  } catch (e) {
    console.error("[10dlc] register:", e)
    return NextResponse.json({ error: "Could not start registration" }, { status: 500 })
  }
}
