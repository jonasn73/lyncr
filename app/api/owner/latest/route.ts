// GET /api/owner/latest — recent customer SMS + finished jobs for the Lines “Latest” card.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getDefaultOrganizationForOwner,
  getOrganizationForOwner,
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
import { buildTodayJustFinishedJobs, todayLocalRangeIso } from "@/lib/today-board"

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

    const { fromIso, toIso } = todayLocalRangeIso(new Date())

    const [orgMessages, dayEvents, reviewHints] = await Promise.all([
      org ? listSmsMessagesForOrganization(userId, org.id, 120) : Promise.resolve([]),
      listOwnerSchedulerEvents({
        ownerUserId: userId,
        fromIso,
        toIso,
        limit: 80,
      }),
      listReviewLinkClickHintsForOwner(userId, 40),
    ])

    // If this workspace has no SMS rows, still show owner-wide texts (null/other org).
    const messages =
      orgMessages.length > 0 ? orgMessages : await listSmsMessagesForOwner(userId, 120)

    // Map phones → customer names + completed job ids from today’s calendar.
    const nameHints: LatestActionNameHint[] = []
    const sortedEvents = [...dayEvents].sort((a, b) => {
      const aT = Date.parse(a.scheduled_at || a.created_at) || 0
      const bT = Date.parse(b.scheduled_at || b.created_at) || 0
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
      })
    }

    const finishedJobs = buildTodayJustFinishedJobs(dayEvents, 6)
    const completedJobs: LatestCompletedJobHint[] = finishedJobs.map((job) => {
      const ev = dayEvents.find((e) => e.id === job.id)
      return {
        id: job.id,
        customerPhone: job.customerPhone,
        customerName: job.customerName,
        location: job.location,
        summary: job.summary,
        at: job.scheduledAt || new Date().toISOString(),
        reviewSmsSentAt: ev?.review_sms_sent_at ?? null,
      }
    })

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
      },
    })
  } catch (e) {
    console.error("[GET /api/owner/latest]", e)
    return NextResponse.json({ error: "Could not load latest actions" }, { status: 500 })
  }
}
