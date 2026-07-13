// POST /api/telnyx-menu — traditional Telnyx TeXML IVR Gather handler.
// Loads dashboard-saved IVR greeting + digit actions from routing_config / phone_numbers.
// Digits fire sms_link | live_booking | voicemail (no AI).
//
// (App Router equivalent of pages/api/telnyx-menu.ts)

import { NextRequest, NextResponse } from "next/server"
import { listOwnerSchedulerEvents, normalizePhoneNumberE164 } from "@/lib/db"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"
import { monthRangeUtc } from "@/lib/scheduler-utils"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { getAppUrl } from "@/lib/telnyx"
import { toE164 } from "@/lib/phone-e164"
import { getIvrMenuSettingsByInboundDid } from "@/lib/ivr-menu-db"
import { listScheduleBlockouts } from "@/lib/schedule-blockouts-db"
import { defaultIntakeScheduleDate } from "@/lib/intake-schedule-helpers"
import {
  DEFAULT_IVR_MENU_SETTINGS,
  type IvrMenuAction,
  type IvrMenuSettings,
} from "@/lib/ivr-menu-settings"
import {
  TELNYX_MENU_DIGIT1_SAY,
  TELNYX_MENU_DIGIT2_SAY,
  TELNYX_MENU_XML_CONTENT_TYPE,
  buildTelnyxMenuBookingSms,
  buildTelnyxMenuGatherXml,
  buildTelnyxMenuInvalidRedirectXml,
  buildTelnyxMenuSayHangupXml,
  buildTelnyxMenuVoicemailXml,
  getEarliestOpenBlockTomorrow,
} from "@/lib/telnyx-menu"
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

function menuSelfUrl(): string {
  return `${getAppUrl().replace(/\/+$/, "")}/api/telnyx-menu`
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
}> {
  if (!toRaw.trim()) {
    return { ownerUserId: null, settings: { ...DEFAULT_IVR_MENU_SETTINGS } }
  }
  try {
    return await getIvrMenuSettingsByInboundDid(toRaw)
  } catch (e) {
    console.warn("[telnyx-menu] IVR settings lookup failed:", e)
    return { ownerUserId: null, settings: { ...DEFAULT_IVR_MENU_SETTINGS } }
  }
}

async function runSmsLinkAction(opts: {
  fromE164: string
  ownerUserId: string | null
  /** Business DID so /book knows which calendar to show. */
  businessLineE164?: string
}): Promise<string> {
  if (opts.fromE164) {
    const text = buildTelnyxMenuBookingSms(
      opts.fromE164,
      "https://lyncr.app/book",
      opts.businessLineE164
    )
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
  const cb = `${menuSelfUrl()}?step=vm-done`
  return buildTelnyxMenuVoicemailXml(cb)
}

async function dispatchIvrAction(opts: {
  action: IvrMenuAction
  fromE164: string
  ownerUserId: string | null
  businessLineE164?: string
}): Promise<string> {
  switch (opts.action) {
    case "sms_link":
      return runSmsLinkAction(opts)
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

/** Play the Gather menu using the line’s saved greeting (or defaults). */
export async function GET(req: NextRequest) {
  const to =
    req.nextUrl.searchParams.get("To") ||
    req.nextUrl.searchParams.get("to") ||
    ""
  const { settings } = to ? await resolveIvrContext(to) : { settings: DEFAULT_IVR_MENU_SETTINGS }
  return xmlResponse(buildTelnyxMenuGatherXml(menuSelfUrl(), settings.ivrGreetingText))
}

export async function POST(req: NextRequest) {
  const fields = await readTelnyxFields(req)
  const digits = pickField(fields, ["Digits", "digits", "Digit", "dtmf"])
  const fromRaw = pickField(fields, ["From", "from", "Caller", "caller"])
  const toRaw = pickField(fields, ["To", "to", "Called", "called"])
  const fromE164 = fromRaw ? normalizePhoneNumberE164(fromRaw) || toE164(fromRaw) : ""
  const businessLineE164 = toRaw ? normalizePhoneNumberE164(toRaw) || toE164(toRaw) : ""
  const step = pickField(fields, ["step"])

  // After voicemail Record completes, hang up politely.
  if (step === "vm-done") {
    return xmlResponse(buildTelnyxMenuSayHangupXml("Thank you. Goodbye."))
  }

  const { ownerUserId, settings } = await resolveIvrContext(toRaw)

  // No Digits yet → present the dashboard-configured IVR greeting.
  if (!digits) {
    return xmlResponse(buildTelnyxMenuGatherXml(menuSelfUrl(), settings.ivrGreetingText))
  }

  if (digits === "1") {
    const xml = await dispatchIvrAction({
      action: settings.ivrOption1Action,
      fromE164,
      ownerUserId,
      businessLineE164,
    })
    return xmlResponse(xml)
  }

  if (digits === "2") {
    const xml = await dispatchIvrAction({
      action: settings.ivrOption2Action,
      fromE164,
      ownerUserId,
      businessLineE164,
    })
    return xmlResponse(xml)
  }

  // Invalid keypress → back to menu with the same custom greeting.
  return xmlResponse(buildTelnyxMenuInvalidRedirectXml(menuSelfUrl()))
}
