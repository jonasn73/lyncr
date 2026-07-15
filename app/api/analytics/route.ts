// ============================================
// GET /api/analytics
// ============================================
// Returns talk time, earnings, and call stats for receptionist payroll.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { calculateReceptionistPayTotal } from "@/lib/receptionist-pay"
import { getAgentTalkTime, getBillingCycleWindowForUser } from "@/lib/db"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const { searchParams } = req.nextUrl
    const billingCycle = await getBillingCycleWindowForUser(userId)
    const startDate = searchParams.get("start") || billingCycle.start
    const endDate = searchParams.get("end") || billingCycle.end

    const agentStats = await getAgentTalkTime(userId, startDate, endDate)

    const agents = agentStats.map((a) => {
      const total_earnings = calculateReceptionistPayTotal({
        payMode: a.pay_mode,
        ratePerMinute: a.rate_per_minute,
        flatRateUsd: a.flat_rate_usd,
        answeredCalls: a.total_calls,
        totalTalkSeconds: a.total_seconds,
      })
      return {
        id: a.receptionist_id,
        name: a.receptionist_name,
        pay_mode: a.pay_mode,
        rate_per_minute: a.rate_per_minute,
        flat_rate_usd: a.flat_rate_usd,
        total_minutes: Math.round((a.total_seconds / 60) * 10) / 10,
        total_calls: a.total_calls,
        total_earnings,
        daily: a.daily.map((d) => ({
          date: d.date,
          minutes: Math.round((d.seconds / 60) * 10) / 10,
          calls: d.calls,
        })),
      }
    })

    const totalMinutes = agents.reduce((sum, a) => sum + a.total_minutes, 0)
    const totalEarnings = agents.reduce((sum, a) => sum + a.total_earnings, 0)
    const totalCalls = agents.reduce((sum, a) => sum + a.total_calls, 0)

    return NextResponse.json({
      data: {
        summary: {
          total_minutes: Math.round(totalMinutes * 10) / 10,
          total_earnings: Math.round(totalEarnings * 100) / 100,
          total_calls: totalCalls,
          avg_call_duration: totalCalls > 0 ? Math.round((totalMinutes / totalCalls) * 60) : 0,
        },
        agents,
        period: { start: startDate, end: endDate },
      },
    })
  } catch (error) {
    console.error("[lyncr] Error fetching analytics:", error)
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    )
  }
}
