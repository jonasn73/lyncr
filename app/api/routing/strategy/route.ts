// ============================================
// GET/PUT /api/routing/strategy
// ============================================
// Reads / writes the hybrid-network routing strategy (`048`/`049`) for a line:
//   - routing_strategy: private_only | lyncr_only | hybrid_fallback
//   - allow_lyncr_network_fallback: boolean
//   - private_ring_timeout_seconds: integer (how long to ring private staff first)
//
// Pass ?number=+1XXXXXXXXXX (GET) or { business_number } (PUT) to target a specific
// line; omit it to operate on the account default. Fully defensive — works whether or
// not migrations 048/049 have been applied (values just fall back to defaults).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getLineHybridRoutingStrategy, updateRoutingConfig } from "@/lib/db"
import type { RoutingStrategy } from "@/lib/types"

const VALID_STRATEGIES: RoutingStrategy[] = ["private_only", "lyncr_only", "hybrid_fallback"]

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const number = req.nextUrl.searchParams.get("number")
    const strategy = await getLineHybridRoutingStrategy(userId, number)
    return NextResponse.json({ data: strategy })
  } catch (error) {
    console.error("[routing/strategy] GET:", error)
    return NextResponse.json({ error: "Failed to load routing strategy" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      routing_strategy?: string
      allow_lyncr_network_fallback?: boolean
      private_ring_timeout_seconds?: number
      business_number?: string | null
    }

    const businessNumber =
      typeof body.business_number === "string" && body.business_number.trim() !== ""
        ? body.business_number.trim()
        : null

    // Validate the strategy enum (the only field that can break routing if garbage).
    if (
      body.routing_strategy !== undefined &&
      !VALID_STRATEGIES.includes(body.routing_strategy as RoutingStrategy)
    ) {
      return NextResponse.json({ error: "Invalid routing_strategy" }, { status: 400 })
    }

    // Clamp the timeout to a sane phone-ring window (5–60s).
    let timeout: number | undefined
    if (body.private_ring_timeout_seconds !== undefined) {
      const n = Math.round(Number(body.private_ring_timeout_seconds))
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: "Invalid private_ring_timeout_seconds" }, { status: 400 })
      }
      timeout = Math.min(60, Math.max(5, n))
    }

    await updateRoutingConfig(
      userId,
      {
        ...(body.routing_strategy !== undefined
          ? { routing_strategy: body.routing_strategy as RoutingStrategy }
          : {}),
        ...(body.allow_lyncr_network_fallback !== undefined
          ? { allow_lyncr_network_fallback: Boolean(body.allow_lyncr_network_fallback) }
          : {}),
        ...(timeout !== undefined ? { private_ring_timeout_seconds: timeout } : {}),
      },
      businessNumber
    )

    const strategy = await getLineHybridRoutingStrategy(userId, businessNumber)
    return NextResponse.json({ data: strategy })
  } catch (error) {
    console.error("[routing/strategy] PUT:", error)
    return NextResponse.json({ error: "Failed to save routing strategy" }, { status: 500 })
  }
}
