// POST /api/telnyx-menu — traditional Telnyx TeXML IVR Gather handler.
// Multi-step Key Squad flow:
//   Digits 1 → SMS secure /book/[id] link + Hangup
//   Digits 2 → Dial owner cell (20s); unanswered → busy Gather → SMS again
//
// (App Router equivalent of pages/api/telnyx-menu.ts)

import { NextRequest, NextResponse } from "next/server"
import { listOwnerSchedulerEvents, normalizePhoneNumberE164, updateCallLog } from "@/lib/db"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"
import { monthRangeUtc } from "@/lib/scheduler-utils"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { getAppUrl } from "@/lib/telnyx"
import { toE164 } from "@/lib/phone-e164"
import { getIvrMenuSettingsByInboundDid } from "@/lib/ivr-menu-db"
import { listScheduleBlockouts } from "@/lib/schedule-blockouts-db"
import { defaultIntakeScheduleDate } from "@/lib/intake-schedule-helpers"
import { markIvrActionCompleted } from "@/lib/missed-call-rescue"
import { IVR_MENU_ROUTED_TO_NAME } from "@/lib/missed-call-telemetry"
import { buildBookQueryUrl, createBookingInvite } from "@/lib/booking-invite"
import {
  DEFAULT_IVR_MENU_SETTINGS,
  type IvrMenuAction,
  type IvrMenuSettings,
} from "@/lib/ivr-menu-settings"
import {
  TELNYX_MENU_BUSY_FALLBACK_PROMPT,
  TELNYX_MENU_DEFAULT_RING_E164,
  TELNYX_MENU_DIGIT1_SAY,
  TELNYX_MENU_DIGIT2_SAY,
  TELNYX_MENU_DIAL_TIMEOUT_SECONDS,
  TELNYX_MENU_PROMPT,
  TELNYX_MENU_XML_CONTENT_TYPE,
  buildTelnyxMenuBookingSms,
  buildTelnyxMenuBusyFallbackGatherXml,
  buildTelnyxMenuDialXml,
  buildTelnyxMenuGatherXml,
  buildTelnyxMenuHangupXml,
  buildTelnyxMenuInvalidRedirectXml,
  buildTelnyxMenuSayHangupXml,
  buildTelnyxMenuVoicemailXml,
  getEarliestOpenBlockTomorrow,
  isTelnyxMenuDialUnanswered,
} from "@/lib/telnyx-menu"
import {
  buildCalendarFullDayGatherXml,
  buildCalendarPartialBusyGatherXml,
  buildDayCaptureDialXml,
  buildPresenceClosedGatherXml,
  buildPresenceOnJobGatherXml,
  DAY_CAPTURE_DIAL_TIMEOUT_SECONDS,
  resolveInboundCapturePlan,
} from "@/lib/inbound-time-capture"
import {
  getAccountPresence,
  resolvePresenceAutomationGreeting,
} from "@/lib/account-presence"
import type { ScheduleBlockout, SchedulerEvent } from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function xmlResponse(xml: string, status = 200): NextResponse {
  return new NextResponse(xml, {
    status,
    headers: {
      "Content-Type": TELNYX_MENU_XML_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  })
}

function pickField(fields: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = fields[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

async function readTelnyxFields(req: NextRequest): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  req.nextUrl.searchParams.forEach((v, k) => {
    out[k] = v
  })
  if (req.method === "POST") {
    try {
      const ct = (req.headers.get("content-type") || "").toLowerCase()
      if (ct.includes("application/json")) {
        const json = (await req.json()) as Record<string, unknown>
        for (const [k, v] of Object.entries(json)) {
          if (v != null && !(k in out)) out[k] = String(v)
        }
      } else {
        const form = await req.formData()
        form.forEach((v, k) => {
          if (!(k in out)) out[k] = String(v)
        })
      }
    } catch {
      /* empty body — treat as menu entry */
    }
  }
  return out
}

function menuSelfUrl(qs?: Record<string, string>): string {
  const base = `${getAppUrl().replace(/\/+$/, "")}/api/telnyx-menu`
  if (!qs || Object.keys(qs).length === 0) return base
  const params = new URLSearchParams(qs)
  return `${base}?${params.toString()}`
}

async function loadOwnerMonthEvents(ownerUserId: string): Promise<SchedulerEvent[]> {
  const now = new Date()
  const range = monthRangeUtc(now.getFullYear(), now.getMonth())
  try {
    return await listOwnerSchedulerEvents({
      ownerUserId,
      fromIso: range.from,
      toIso: range.to,
    })
  } catch (e) {
    console.warn("[telnyx-menu] scheduler list skipped:", e)
    return []
  }
}

/** Load blockouts covering tomorrow + a short lookahead for IVR slot math. */
async function loadOwnerBlockoutsNearNow(ownerUserId: string): Promise<ScheduleBlockout[]> {
  const now = new Date()
  const from = defaultIntakeScheduleDate(now)
  const ahead = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 16)
  const to = defaultIntakeScheduleDate(ahead)
  try {
    return await listScheduleBlockouts({
      ownerUserId,
      fromDate: from,
      toDate: to,
    })
  } catch (e) {
    console.warn("[telnyx-menu] blockouts list skipped:", e)
    return []
  }
}

async function resolveIvrContext(toRaw: string): Promise<{
  ownerUserId: string | null
  settings: IvrMenuSettings
  ringE164: string
}> {
  if (!toRaw.trim()) {
    return {
      ownerUserId: null,
      settings: { ...DEFAULT_IVR_MENU_SETTINGS },
      ringE164: TELNYX_MENU_DEFAULT_RING_E164,
    }
  }
  try {
    const { ownerUserId, settings } = await getIvrMenuSettingsByInboundDid(toRaw)
    const ringE164 = await resolveOwnerRingE164(ownerUserId, toRaw)
    return { ownerUserId, settings, ringE164 }
  } catch (e) {
    console.warn("[telnyx-menu] IVR settings lookup failed:", e)
    return {
      ownerUserId: null,
      settings: { ...DEFAULT_IVR_MENU_SETTINGS },
      ringE164: TELNYX_MENU_DEFAULT_RING_E164,
    }
  }
}

/** Prefer account owner cell via AVAILABLE receptionist → OWNER; fall back to Key Squad cell. */
async function resolveOwnerRingE164(
  ownerUserId: string | null,
  businessLineRaw: string
): Promise<string> {
  if (ownerUserId) {
    try {
      const { findActiveOperatorForAccount } = await import("@/lib/active-operator")
      const active = await findActiveOperatorForAccount(ownerUserId)
      if (active?.phoneE164) return active.phoneE164
    } catch (e) {
      console.warn("[telnyx-menu] active operator lookup failed:", e)
    }
  }
  const line = normalizePhoneNumberE164(businessLineRaw) || toE164(businessLineRaw)
  // Never dial the business DID back to itself — use the default cell.
  if (line && line === TELNYX_MENU_DEFAULT_RING_E164) return TELNYX_MENU_DEFAULT_RING_E164
  return TELNYX_MENU_DEFAULT_RING_E164
}

async function resolveSecureBookUrl(opts: {
  fromE164: string
  ownerUserId: string | null
  businessLineE164?: string
  source?: string
}): Promise<string> {
  const line = opts.businessLineE164?.trim() || ""
  if (opts.ownerUserId && line) {
    const created = await createBookingInvite({
      ownerUserId: opts.ownerUserId,
      businessLine: line,
      callerPhone: opts.fromE164 || null,
      source: opts.source || "ivr",
    })
    if (created?.url) return created.url
  }
  return buildBookQueryUrl({
    callerPhone: opts.fromE164,
    businessLine: line || opts.fromE164,
  })
}

async function runSmsLinkAction(opts: {
  fromE164: string
  ownerUserId: string | null
  /** Business DID so /book knows which calendar to show. */
  businessLineE164?: string
  source?: string
}): Promise<string> {
  if (opts.fromE164) {
    const bookUrl = await resolveSecureBookUrl(opts)
    const text = buildTelnyxMenuBookingSms(opts.fromE164, bookUrl, opts.businessLineE164)
    try {
      const sent = await sendTelnyxSms({
        toE164: opts.fromE164,
        text,
        userId: opts.ownerUserId || undefined,
      })
      if (!sent.ok) console.warn("[telnyx-menu] sms_link failed:", sent.error)
    } catch (e) {
      console.warn("[telnyx-menu] sms_link threw:", e)
    }
  }
  return buildTelnyxMenuSayHangupXml(TELNYX_MENU_DIGIT1_SAY)
}

function runRingPhoneAction(opts: {
  ringE164: string
  businessLineE164?: string
}): string {
  const actionUrl = menuSelfUrl({ step: "dial-fallback" })
  return buildTelnyxMenuDialXml({
    ringE164: opts.ringE164 || TELNYX_MENU_DEFAULT_RING_E164,
    actionUrl,
    callerId: opts.businessLineE164 || null,
    timeoutSeconds: TELNYX_MENU_DIAL_TIMEOUT_SECONDS,
  })
}

async function runLiveBookingAction(opts: {
  fromE164: string
  ownerUserId: string | null
}): Promise<string> {
  if (opts.ownerUserId && opts.fromE164) {
    try {
      const [events, blockouts] = await Promise.all([
        loadOwnerMonthEvents(opts.ownerUserId),
        loadOwnerBlockoutsNearNow(opts.ownerUserId),
      ])
      const slot = getEarliestOpenBlockTomorrow(events, new Date(), blockouts)
      // Full-day blockout or zero open 1-hour slots → tell the caller we are fully booked.
      if (!slot) {
        return buildTelnyxMenuSayHangupXml(
          "We are fully booked for tomorrow. Please try again another day, or press 1 next time for a booking link. Goodbye."
        )
      }

      await createUnassignedJobFromIntake({
        ownerUserId: opts.ownerUserId,
        callerE164: opts.fromE164,
        customerName: "IVR priority hold",
        jobType: "Priority slot (IVR)",
        notes: `Temporary reservation via Telnyx menu live_booking · ${slot.text}`,
        scheduledAtIso: slot.scheduledAtIso,
        pendingCallback: true,
      })
    } catch (e) {
      console.warn("[telnyx-menu] live_booking reservation failed:", e)
    }
  }
  return buildTelnyxMenuSayHangupXml(TELNYX_MENU_DIGIT2_SAY)
}

function runVoicemailAction(): string {
  const cb = menuSelfUrl({ step: "vm-done" })
  return buildTelnyxMenuVoicemailXml(cb)
}

async function dispatchIvrAction(opts: {
  action: IvrMenuAction
  fromE164: string
  ownerUserId: string | null
  businessLineE164?: string
  ringE164: string
}): Promise<string> {
  switch (opts.action) {
    case "sms_link":
      return runSmsLinkAction(opts)
    case "ring_phone":
      return runRingPhoneAction(opts)
    case "live_booking":
      return runLiveBookingAction(opts)
    case "voicemail":
      return runVoicemailAction()
    case "do_nothing":
      return buildTelnyxMenuSayHangupXml("Thank you for calling. Goodbye.")
    default:
      return buildTelnyxMenuSayHangupXml("Thank you for calling. Goodbye.")
  }
}

/** Calendar + presence entry TeXML (shared with /api/telnyx-capture).
 * Fetches presence via resolveInboundCapturePlan → getAccountPresence,
 * then Speak uses account_settings custom greetings (or product defaults).
 */
async function buildCalendarAwareEntryXml(opts: {
  ownerUserId: string | null
  ringE164: string
  businessLineE164: string
}): Promise<string> {
  // Load ACTIVE line presence (CLOSED / ON_JOB / AVAILABLE) + calendar overrides.
  const plan = await resolveInboundCapturePlan({ ownerUserId: opts.ownerUserId })
  const captureBase = `${getAppUrl().replace(/\/+$/, "")}/api/telnyx-capture`

  // Custom Speak scripts from account_settings (dashboard Automation Voice Greetings).
  let onJobGreeting: string | undefined
  let closedGreeting: string | undefined
  if (opts.ownerUserId) {
    try {
      const presence = await getAccountPresence(opts.ownerUserId)
      onJobGreeting = presence.onJobGreetingText
      closedGreeting = presence.closedGreetingText
    } catch (e) {
      console.warn("[telnyx-menu] presence greeting lookup skipped:", e)
    }
  }

  // Manual Closed → off-duty Speak (custom closed_greeting_text || default).
  if (plan.kind === "presence_closed") {
    const say = resolvePresenceAutomationGreeting({
      presenceStatus: "CLOSED",
      closedGreetingText: closedGreeting,
    })
    return buildPresenceClosedGatherXml(`${captureBase}?step=presence-closed`, say)
  }
  if (plan.kind === "calendar_full_day") {
    return buildCalendarFullDayGatherXml(`${captureBase}?step=calendar-off`)
  }
  if (plan.kind === "calendar_partial") {
    return buildCalendarPartialBusyGatherXml(`${captureBase}?step=calendar-busy`)
  }
  // On Job → live lockout Speak (custom on_job_greeting_text || default).
  if (plan.kind === "presence_on_job") {
    const say = resolvePresenceAutomationGreeting({
      presenceStatus: "ON_JOB",
      onJobGreetingText: onJobGreeting,
    })
    return buildPresenceOnJobGatherXml(`${captureBase}?step=presence-on-job`, say)
  }
  return buildDayCaptureDialXml({
    ringE164: opts.ringE164 || TELNYX_MENU_DEFAULT_RING_E164,
    actionUrl: `${captureBase}?step=day-fallback`,
    callerId: opts.businessLineE164 || null,
    timeoutSeconds: DAY_CAPTURE_DIAL_TIMEOUT_SECONDS,
  })
}

/** Play the Gather menu using calendar-aware capture (blockouts → day/night). */
export async function GET(req: NextRequest) {
  const to =
    req.nextUrl.searchParams.get("To") ||
    req.nextUrl.searchParams.get("to") ||
    ""
  const { ownerUserId, ringE164 } = to
    ? await resolveIvrContext(to)
    : { ownerUserId: null, ringE164: TELNYX_MENU_DEFAULT_RING_E164 }
  const businessLineE164 = to ? normalizePhoneNumberE164(to) || toE164(to) : ""
  return xmlResponse(
    await buildCalendarAwareEntryXml({
      ownerUserId,
      ringE164,
      businessLineE164,
    })
  )
}

export async function POST(req: NextRequest) {
  const fields = await readTelnyxFields(req)
  const digits = pickField(fields, ["Digits", "digits", "Digit", "dtmf"])
  const fromRaw = pickField(fields, ["From", "from", "Caller", "caller"])
  const toRaw = pickField(fields, ["To", "to", "Called", "called"])
  const fromE164 = fromRaw ? normalizePhoneNumberE164(fromRaw) || toE164(fromRaw) : ""
  const businessLineE164 = toRaw ? normalizePhoneNumberE164(toRaw) || toE164(toRaw) : ""
  const step = pickField(fields, ["step"])
  const dialStatus = pickField(fields, [
    "DialCallStatus",
    "DialStatus",
    "DialCallLegStatus",
    "DialCallLegState",
  ])

  // After voicemail Record completes, hang up politely.
  if (step === "vm-done") {
    return xmlResponse(buildTelnyxMenuSayHangupXml("Thank you. Goodbye."))
  }

  const { ownerUserId, settings, ringE164 } = await resolveIvrContext(toRaw)

  const callSid = pickField(fields, ["CallSid", "CallControlId", "call_control_id"])
  // Reinforce IVR tagging whenever the menu Gather runs (covers status "answered" races).
  if (callSid) {
    void updateCallLog(callSid, {
      routed_to_name: IVR_MENU_ROUTED_TO_NAME,
      call_type: "missed",
    }).catch((e) => console.warn("[telnyx-menu] IVR call-log tag failed:", e))
  }

  // Digits=2 Dial action callback — unanswered → busy Gather; answered/completed → hangup.
  if (step === "dial-fallback") {
    if (dialStatus && !isTelnyxMenuDialUnanswered(dialStatus)) {
      // Owner connected (or call already ended after a bridge) — clean hangup.
      return xmlResponse(buildTelnyxMenuHangupXml())
    }
    // no-answer / busy / failed / timeout / missing status → offer SMS booking again.
    return xmlResponse(
      buildTelnyxMenuBusyFallbackGatherXml(
        menuSelfUrl({ step: "busy-gather" }),
        TELNYX_MENU_BUSY_FALLBACK_PROMPT
      )
    )
  }

  // Busy-fallback Gather — Press 1 texts the secure booking link.
  if (step === "busy-gather") {
    if (digits === "1") {
      const xml = await runSmsLinkAction({
        fromE164,
        ownerUserId,
        businessLineE164,
        source: "ivr_busy_fallback",
      })
      if (callSid) void markIvrActionCompleted(callSid)
      return xmlResponse(xml)
    }
    if (!digits) {
      return xmlResponse(buildTelnyxMenuSayHangupXml("Goodbye."))
    }
    return xmlResponse(
      buildTelnyxMenuBusyFallbackGatherXml(
        menuSelfUrl({ step: "busy-gather" }),
        TELNYX_MENU_BUSY_FALLBACK_PROMPT
      )
    )
  }

  // No Digits yet → calendar-aware entry (blockouts override day/night).
  if (!digits) {
    return xmlResponse(
      await buildCalendarAwareEntryXml({
        ownerUserId,
        ringE164,
        businessLineE164,
      })
    )
  }

  if (digits === "1") {
    const xml = await dispatchIvrAction({
      action: settings.ivrOption1Action,
      fromE164,
      ownerUserId,
      businessLineE164,
      ringE164,
    })
    if (callSid) void markIvrActionCompleted(callSid)
    return xmlResponse(xml)
  }

  if (digits === "2") {
    // Product route: Dial owner cell (20s) → unanswered busy SMS fallback.
    const xml = await dispatchIvrAction({
      action: "ring_phone",
      fromE164,
      ownerUserId,
      businessLineE164,
      ringE164,
    })
    return xmlResponse(xml)
  }

  // Invalid keypress → back to menu with the same custom greeting.
  return xmlResponse(buildTelnyxMenuInvalidRedirectXml(menuSelfUrl()))
}
