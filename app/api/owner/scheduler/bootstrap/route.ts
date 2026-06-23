// GET /api/owner/scheduler/bootstrap — calendar events + tech roster + line tags in one round trip

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getPhoneNumbers, listFieldTechnicians, listOwnerSchedulerEvents } from "@/lib/db"
import { monthRangeUtc } from "@/lib/scheduler-utils"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const monthParam = req.nextUrl.searchParams.get("month")
  const organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() || null
  const orgId = organizationId && !organizationId.startsWith("legacy-") ? organizationId : null

  let fromIso: string
  let toIso: string
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number)
    const range = monthRangeUtc(y, m - 1)
    fromIso = range.from
    toIso = range.to
  } else {
    const now = new Date()
    const range = monthRangeUtc(now.getFullYear(), now.getMonth())
    fromIso = range.from
    toIso = range.to
  }

  try {
    const [events, technicians, numbers] = await Promise.all([
      listOwnerSchedulerEvents({
        ownerUserId: userId,
        fromIso,
        toIso,
        organizationId: orgId,
      }),
      listFieldTechnicians(userId, orgId),
      getPhoneNumbers(userId, orgId),
    ])

    const lineIndustryTags = numbers
      .map((n) => n.industry_tag?.trim())
      .filter((t): t is string => Boolean(t))

    return NextResponse.json({
      data: {
        events,
        technicians,
        lineIndustryTags,
        ownerUserId: userId,
        from: fromIso,
        to: toIso,
      },
    })
  } catch (e) {
    console.error("[GET /api/owner/scheduler/bootstrap]", e)
    return NextResponse.json(
      {
        data: {
          events: [],
          technicians: [],
          lineIndustryTags: [],
          ownerUserId: userId,
          from: fromIso,
          to: toIso,
        },
        degraded: true,
      },
      { status: 200 }
    )
  }
}
