// GET/PUT users.require_deposit for public /book Stripe holds.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUserRequireDeposit, setUserRequireDeposit } from "@/lib/booking-deposit"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const require_deposit = await getUserRequireDeposit(userId)
    return NextResponse.json({ data: { require_deposit } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("require_deposit")) {
      return NextResponse.json({
        data: { require_deposit: false },
        migration: "scripts/089-active-routing-mode-and-deposits.sql",
      })
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const require =
    body.require_deposit === true ||
    body.requireDeposit === true ||
    body.require_deposit === "true"

  try {
    await setUserRequireDeposit(userId, require)
    return NextResponse.json({ data: { require_deposit: require } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed"
    return NextResponse.json(
      {
        error: msg,
        migration: msg.includes("require_deposit")
          ? "scripts/089-active-routing-mode-and-deposits.sql"
          : undefined,
      },
      { status: 503 }
    )
  }
}
