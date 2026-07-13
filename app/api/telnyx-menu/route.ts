// POST /api/telnyx-menu — traditional Telnyx TeXML IVR Gather handler.
// Digits=1 → SMS booking link + hangup; Digits=2 → tomorrow priority hold + hangup;
// else → Invalid option + Redirect to menu.
//
// (App Router equivalent of pages/api/telnyx-menu.ts)

import { NextRequest, NextResponse } from "next/server"
import { getIncomingRoutingByNumber, listOwnerSchedulerEvents, normalizePhoneNumberE164 } from "@/lib/db"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"
import { monthRangeUtc } from "@/lib/scheduler-utils"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { getAppUrl } from "@/lib/telnyx"
import { toE164 } from "@/lib/phone-e164"
import {
  TELNYX_MENU_DIGIT1_SAY,
  TELNYX_MENU_DIGIT2_SAY,
  TELNYX_MENU_XML_CONTENT_TYPE,
  buildTelnyxMenuBookingSms,
  buildTelnyxMenuGatherXml,
  buildTelnyxMenuInvalidRedirectXml,
  buildTelnyxMenuSayHangupXml,
  getEarliestOpenBlockTomorrow,
} from "@/lib/telnyx-menu"
import type { SchedulerEvent } from "@/lib/types"

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

async function resolveOwnerUserId(toNumber: string): Promise<string | null> {
  const normalized = normalizePhoneNumberE164(toNumber) || toE164(toNumber)
  if (!normalized) return null
  try {
    const routing = await getIncomingRoutingByNumber(normalized, { bypassCache: true })
    return routing?.user_id?.trim() || null
  } catch (e) {
    console.warn("[telnyx-menu] routing lookup failed:", e)
    return null
  }
}

/** Play the Gather menu (entry point or Redirect target). */
export async function GET() {
  return xmlResponse(buildTelnyxMenuGatherXml(menuSelfUrl()))
}

export async function POST(req: NextRequest) {
  const fields = await readTelnyxFields(req)
  const digits = pickField(fields, ["Digits", "digits", "Digit", "dtmf"])
  const fromRaw = pickField(fields, ["From", "from", "Caller", "caller"])
  const toRaw = pickField(fields, ["To", "to", "Called", "called"])
  const fromE164 = fromRaw ? normalizePhoneNumberE164(fromRaw) || toE164(fromRaw) : ""

  // No Digits yet → present the IVR menu (TeXML may POST on redirect without Digits).
  if (!digits) {
    return xmlResponse(buildTelnyxMenuGatherXml(menuSelfUrl()))
  }

  // ── Digits === "1" → SMS booking link, then polite hangup ──
  if (digits === "1") {
    if (fromE164) {
      const ownerUserId = toRaw ? await resolveOwnerUserId(toRaw) : null
      const text = buildTelnyxMenuBookingSms(fromE164)
      try {
        const sent = await sendTelnyxSms({
          toE164: fromE164,
          text,
          userId: ownerUserId || undefined,
        })
        if (!sent.ok) {
          console.warn("[telnyx-menu] Digits=1 SMS failed:", sent.error)
        }
      } catch (e) {
        console.warn("[telnyx-menu] Digits=1 SMS threw:", e)
      }
    } else {
      console.warn("[telnyx-menu] Digits=1 missing From — skipping SMS")
    }
    return xmlResponse(buildTelnyxMenuSayHangupXml(TELNYX_MENU_DIGIT1_SAY))
  }

  // ── Digits === "2" → temporary tomorrow priority reservation ──
  if (digits === "2") {
    const ownerUserId = toRaw ? await resolveOwnerUserId(toRaw) : null
    if (ownerUserId && fromE164) {
      try {
        const events = await loadOwnerMonthEvents(ownerUserId)
        const slot = getEarliestOpenBlockTomorrow(events, new Date())
        const scheduledAtIso =
          slot?.scheduledAtIso ||
          (() => {
            const d = new Date()
            d.setDate(d.getDate() + 1)
            d.setHours(9, 0, 0, 0)
            return d.toISOString()
          })()

        await createUnassignedJobFromIntake({
          ownerUserId,
          callerE164: fromE164,
          customerName: "IVR priority hold",
          jobType: "Priority slot (IVR)",
          notes: `Temporary reservation via Telnyx menu Digits=2 · ${slot?.text || "Tomorrow morning"}`,
          scheduledAtIso,
          pendingCallback: true,
        })
      } catch (e) {
        console.warn("[telnyx-menu] Digits=2 reservation failed:", e)
      }
    } else {
      console.warn("[telnyx-menu] Digits=2 missing owner or From — spoken success still returned")
    }
    return xmlResponse(buildTelnyxMenuSayHangupXml(TELNYX_MENU_DIGIT2_SAY))
  }

  // ── Fallback — invalid keypress → back to menu ──
  return xmlResponse(buildTelnyxMenuInvalidRedirectXml(menuSelfUrl()))
}
