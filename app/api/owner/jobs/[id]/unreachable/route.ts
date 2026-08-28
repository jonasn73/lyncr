// POST /api/owner/jobs/[id]/unreachable — mark Called · no answer + optional follow-up SMS.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser, markLeadCalledNoAnswer, normalizePhoneNumberE164 } from "@/lib/db"
import { hasOutboundSmsToCustomerRecently } from "@/lib/booking-sms-guards"
import {
  buildUnreachableFollowUpSms,
  UNREACHABLE_SMS_COOLDOWN_MINUTES,
} from "@/lib/unreachable-follow-up"
import { sendAndLogWorkspaceCustomerSms } from "@/lib/workspace-customer-sms"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, context: RouteContext) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id: leadId } = await context.params
  if (!leadId?.trim()) return NextResponse.json({ error: "Missing job id" }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as {
    /** When false, only stamp Called · no answer (no SMS). Default true. */
    send_sms?: boolean
    customer_phone?: string
    customer_name?: string
    /** Optional short book link appended to the text. */
    short_link?: string
  }

  const sendSms = body.send_sms !== false
  const user = await getUser(userId)
  const businessName =
    user?.business_name?.trim() || user?.name?.trim() || "our team"
  const phone = normalizePhoneNumberE164(String(body.customer_phone ?? "").trim())

  try {
    // Always persist the CRM status so the badge updates even if SMS is skipped.
    const stamped = await markLeadCalledNoAnswer({
      ownerUserId: userId,
      leadId: leadId.trim(),
    })
    if (!stamped) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 })
    }

    if (!sendSms) {
      return NextResponse.json({
        data: { marked: true, sms_sent: false, skipped: false },
      })
    }

    if (!phone) {
      return NextResponse.json(
        { error: "Customer phone is required to send the text." },
        { status: 400 }
      )
    }

    const recently = await hasOutboundSmsToCustomerRecently({
      ownerUserId: userId,
      customerPhone: phone,
      withinHours: UNREACHABLE_SMS_COOLDOWN_MINUTES / 60,
    })
    if (recently) {
      return NextResponse.json({
        data: {
          marked: true,
          sms_sent: false,
          skipped: true,
          reason: "sms_within_cooldown",
        },
      })
    }

    const text = buildUnreachableFollowUpSms({
      customerName: body.customer_name,
      businessName,
      shortLink: body.short_link,
    })

    const sent = await sendAndLogWorkspaceCustomerSms({
      ownerUserId: userId,
      toE164: phone,
      text,
    })
    if (!sent.ok) {
      return NextResponse.json(
        {
          error: sent.error || "Could not send the text.",
          data: { marked: true, sms_sent: false },
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      data: {
        marked: true,
        sms_sent: true,
        skipped: false,
        message: sent.message,
        text,
      },
    })
  } catch (e) {
    console.error("[POST /api/owner/jobs/[id]/unreachable]", e)
    return NextResponse.json({ error: "Could not update lead" }, { status: 500 })
  }
}
