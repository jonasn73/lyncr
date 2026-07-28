// GET /api/owner/latest — hot Latest for Lines: unreplied inbound + jobs needing review SMS.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getDefaultOrganizationForOwner,
  getOrganizationForOwner,
  listOwnerJobsNeedingReviewSms,
  listOwnerSchedulerEvents,
  listSmsMessagesForOrganization,
  listSmsMessagesForOwner,
  searchOwnerJobsByPhone,
} from "@/lib/db"
import {
  buildLatestCustomerActions,
  type LatestActionNameHint,
  type LatestCompletedJobHint,
} from "@/lib/latest-customer-actions"
import { listReviewLinkClickHintsForOwner } from "@/lib/review-link-token"
import { sanitizeIanaTimezone } from "@/lib/telemetry-timezone"

function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10)
}

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    let organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() ?? ""
    if (!organizationId) {
      const def = await getDefaultOrganizationForOwner(userId)
      organizationId = def?.id ?? ""
    }
    const org =
      organizationId && !organizationId.startsWith("legacy-")
        ? await getOrganizationForOwner(organizationId, userId)
        : null

    // Browser TZ — Vercel runs UTC; calendar “today” must match the owner’s day.
    const timezone = sanitizeIanaTimezone(req.nextUrl.searchParams.get("timezone"))

    // Name hints: recent scheduler window (48h), not UTC midnight day bounds.
    const toMs = Date.now()
    const fromIso = new Date(toMs - 48 * 60 * 60 * 1000).toISOString()
    const toIso = new Date(toMs).toISOString()

    const [orgMessages, dayEvents, reviewHints, reviewJobs] = await Promise.all([
      org ? listSmsMessagesForOrganization(userId, org.id, 120) : Promise.resolve([]),
      listOwnerSchedulerEvents({
        ownerUserId: userId,
        fromIso,
        toIso,
        limit: 80,
      }),
      listReviewLinkClickHintsForOwner(userId, 40),
      // Completed today (owner TZ) with review_sms_sent_at still null — includes Jason after 8pm ET.
      listOwnerJobsNeedingReviewSms({
        ownerUserId: userId,
        timezone,
        organizationId: org?.id ?? null,
        limit: 12,
      }),
    ])

    // If this workspace has no SMS rows, still show owner-wide texts (null/other org).
    const messages =
      orgMessages.length > 0 ? orgMessages : await listSmsMessagesForOwner(userId, 120)

    // Map phones → customer names from recent calendar + completed review jobs.
    const nameHints: LatestActionNameHint[] = []
    const sortedEvents = [...dayEvents, ...reviewJobs].sort((a, b) => {
      const aT =
        Date.parse(a.completed_at || a.scheduled_at || a.created_at) || 0
      const bT =
        Date.parse(b.completed_at || b.scheduled_at || b.created_at) || 0
      return bT - aT
    })
    for (const ev of sortedEvents) {
      const phone = (ev.customer_phone || "").trim()
      if (!phone) continue
      const completed =
        (ev.job_status ?? "").trim().toLowerCase() === "completed" ? ev.id : null
      nameHints.push({
        phone,
        name: (ev.customer_name || "").trim() || null,
        completedJobId: completed,
        reviewLinkOpenedAt: ev.review_link_opened_at ?? null,
      })
    }

    const completedJobs: LatestCompletedJobHint[] = reviewJobs.map((ev) => ({
      id: ev.id,
      customerPhone: ev.customer_phone,
      customerName: ev.customer_name,
      location: ev.location,
      summary: ev.summary,
      at: ev.completed_at || ev.scheduled_at || ev.created_at || new Date().toISOString(),
      reviewSmsSentAt: ev.review_sms_sent_at ?? null,
      reviewLinkOpenedAt: ev.review_link_opened_at ?? null,
    }))

    // For recent SMS phones missing a today-calendar name, look up the latest job.
    const known = new Set(
      nameHints.map((h) => phoneKey(h.phone)).filter((k) => k.length >= 10)
    )
    const phonesNeedingNames = new Set<string>()
    for (const msg of messages) {
      const phone = (msg.customer_phone || "").trim()
      const k = phoneKey(phone)
      if (!phone || k.length < 10 || known.has(k)) continue
      phonesNeedingNames.add(phone)
      if (phonesNeedingNames.size >= 8) break
    }
    if (phonesNeedingNames.size > 0) {
      const lookups = await Promise.all(
        [...phonesNeedingNames].map(async (phone) => {
          const result = await searchOwnerJobsByPhone({
            ownerUserId: userId,
            phoneQuery: phone,
            organizationId: org?.id ?? null,
          }).catch(() => ({ pool: [], scheduled: [] }))
          const hit = result.scheduled[0] || result.pool[0]
          if (!hit) return null
          const name = (hit.customer_name || "").trim() || null
          const status =
            "job_status" in hit ? String(hit.job_status ?? "").toLowerCase() : ""
          return {
            phone,
            name,
            completedJobId: status === "completed" ? hit.id : null,
          } satisfies LatestActionNameHint
        })
      )
      for (const hint of lookups) {
        if (hint) nameHints.push(hint)
      }
    }

    const latest = buildLatestCustomerActions({
      messages,
      nameHints,
      reviewHints,
      completedJobs,
      limit: 6,
    })

    return NextResponse.json({
      data: {
        latest,
        organization_id: org?.id ?? null,
        timezone,
      },
    })
  } catch (e) {
    console.error("[GET /api/owner/latest]", e)
    return NextResponse.json({ error: "Could not load latest actions" }, { status: 500 })
  }
}
