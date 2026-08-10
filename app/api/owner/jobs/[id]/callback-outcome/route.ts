// POST /api/owner/jobs/[id]/callback-outcome — Called · no answer / Called · answered (+ optional SMS).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser, markLeadCallbackOutcome, normalizePhoneNumberE164 } from "@/lib/db"
import { hasOutboundSmsToCustomerRecently } from "@/lib/missed-call-rescue"
import {
  buildUnreachableFollowUpSms,
  crmCallbackOutcomeLabel,
  type LeadCallbackOutcome,
  UNREACHABLE_SMS_COOLDOWN_MINUTES,
} from "@/lib/unreachable-follow-up"
import { sendAndLogWorkspaceCustomerSms } from "@/lib/workspace-customer-sms"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

const ALLOWED: Set<LeadCallbackOutcome> = new Set(["called_no_answer", "called_answered"])

export async function POST(req: NextRequest, context: RouteContext) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id: leadId } = await context.params
  if (!leadId?.trim()) return NextResponse.json({ error: "Missing job id" }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as {
    outcome?: string
    /** Only used for called_no_answer — send the couldn’t-reach text. Default false. */
    send_sms?: boolean
    customer_phone?: string
    customer_name?: string
    short_link?: string
  }

  const outcomeRaw = String(body.outcome ?? "called_no_answer").trim().toLowerCase()
  if (!ALLOWED.has(outcomeRaw as LeadCallbackOutcome)) {
    return NextResponse.json(
      { error: "outcome must be called_no_answer or called_answered" },
      { status: 400 }
    )
  }
  const outcome = outcomeRaw as LeadCallbackOutcome
  const sendSms = body.send_sms === true && outcome === "called_no_answer"
  const user = await getUser(userId)
  const businessName =
    user?.business_name?.trim() || user?.name?.trim() || "our team"
  const phone = normalizePhoneNumberE164(String(body.customer_phone ?? "").trim())

  try {
    const stamped = await markLeadCallbackOutcome({
      ownerUserId: userId,
      leadId: leadId.trim(),
      outcome,
    })
    if (!stamped) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 })
    }

    const label = crmCallbackOutcomeLabel(outcome)

    if (!sendSms) {
      return NextResponse.json({
        data: { marked: true, outcome, label, sms_sent: false, skipped: false },
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
          outcome,
          label,
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
          data: { marked: true, outcome, label, sms_sent: false },
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      data: {
        marked: true,
        outcome,
        label,
        sms_sent: true,
        skipped: false,
        message: sent.message,
        text,
      },
    })
  } catch (e) {
    console.error("[POST /api/owner/jobs/[id]/callback-outcome]", e)
    return NextResponse.json({ error: "Could not update lead" }, { status: 500 })
  }
}
