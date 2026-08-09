// ============================================
// POST /api/calls/queue/answer — Answer a waiting hold-queue caller from Lines
// ============================================
// Dials the owner (or Available teammate) cell; when they pick up, Call Control
// bridges that leg to the waiting caller (queue head or specific call_control_id).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getCallQueueById,
  listWaitingCallQueue,
  updateCallQueueStatus,
} from "@/lib/call-queue-db"
import { getFirstAvailableOwnerReceptionist } from "@/lib/active-routing-mode-db"
import {
  getUser,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { lyncrHoldQueueName } from "@/lib/hold-queue"
import { lyncrLog } from "@/lib/lyncr-env"
import { getOrCreateCallControlApp } from "@/lib/telnyx-call-control-config"
import { telnyxCallControlDial } from "@/lib/telnyx-call-control-api"
import {
  encodeTelnyxCallControlState,
  type TelnyxCallControlClientState,
} from "@/lib/telnyx-call-control-state"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function POST(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req.headers.get("cookie"))
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as {
      queueEntryId?: string
      /** Optional override — default owner / Available teammate cell. */
      answerAsE164?: string
    }

    // Prefer a specific waiting row; otherwise take the oldest waiting caller.
    let target = body.queueEntryId
      ? await getCallQueueById(String(body.queueEntryId), userId)
      : null
    if (!target) {
      const waiting = await listWaitingCallQueue(userId)
      target = waiting[0] ?? null
    }
    if (!target || !["waiting", "holding", "bridging"].includes(target.status)) {
      return NextResponse.json({ error: "No caller waiting in the hold queue" }, { status: 404 })
    }

    // Who rings for Answer: Available teammate first (same dial-plan spirit), else owner cell.
    let answerTo = ""
    const override = typeof body.answerAsE164 === "string" ? body.answerAsE164.trim() : ""
    if (override && isReasonablePstnDialString(override)) {
      answerTo = normalizePhoneNumberE164(override) || override
    } else {
      const teammate = await getFirstAvailableOwnerReceptionist({ ownerUserId: userId }).catch(
        () => null
      )
      if (teammate?.phoneE164 && isReasonablePstnDialString(teammate.phoneE164)) {
        answerTo = normalizePhoneNumberE164(teammate.phoneE164) || teammate.phoneE164
      } else {
        const owner = await getUser(userId)
        const ownerPhone = owner?.phone ? normalizePhoneNumberE164(owner.phone) : ""
        if (ownerPhone && isReasonablePstnDialString(ownerPhone)) answerTo = ownerPhone
      }
    }
    if (!answerTo) {
      return NextResponse.json(
        {
          error:
            "No phone to ring for Answer — set your owner cell or an Available teammate.",
        },
        { status: 400 }
      )
    }

    const fromE164 =
      (target.business_line_e164 && isReasonablePstnDialString(target.business_line_e164)
        ? normalizePhoneNumberE164(target.business_line_e164) || target.business_line_e164
        : "") || answerTo

    const connectionId = await getOrCreateCallControlApp()
    const queueName = target.queue_name || lyncrHoldQueueName(userId)
    const agentState: TelnyxCallControlClientState = {
      v: 1,
      phase: "await_queue_agent_answer",
      userId,
      businessLineE164: fromE164,
      callerE164: target.caller_e164 || "Unknown",
      dialTargetE164: answerTo,
      dialReason: "queue_answer",
      holdQueueName: queueName,
      queueTargetCallControlId: target.call_control_id,
      queueEntryId: target.id,
      inboundCallControlId: target.call_control_id,
    }

    await updateCallQueueStatus({ callControlId: target.call_control_id, status: "bridging" })

    const dialRes = await telnyxCallControlDial({
      connectionId,
      // link_to the waiting inbound leg so Telnyx can relate the legs.
      inboundCallControlId: target.call_control_id,
      toE164: answerTo,
      fromE164,
      timeoutSecs: 45,
      clientState: encodeTelnyxCallControlState(agentState),
    })

    if (!dialRes.ok) {
      await updateCallQueueStatus({ callControlId: target.call_control_id, status: "waiting" })
      console.error(
        lyncrLog("queue-answer-dial-failed", {
          error: dialRes.error,
          queueEntryId: target.id,
        })
      )
      return NextResponse.json({ error: dialRes.error || "Dial failed" }, { status: 502 })
    }

    console.log(
      lyncrLog("queue-answer-dial-started", {
        queueEntryId: target.id,
        agentTail4: answerTo.replace(/\D/g, "").slice(-4),
        waitingCallControlId: target.call_control_id,
      })
    )

    return NextResponse.json({
      data: {
        ok: true,
        queueEntryId: target.id,
        ringingE164: answerTo,
        outboundCallControlId: dialRes.callControlId ?? null,
      },
    })
  } catch (e) {
    console.error("[POST /api/calls/queue/answer]", e)
    return NextResponse.json({ error: "Could not answer hold queue" }, { status: 500 })
  }
}
