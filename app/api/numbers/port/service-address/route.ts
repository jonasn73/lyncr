// GET/POST /api/numbers/port/service-address — address only (for LNP port, not full 10DLC review).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import {
  getPortServiceAddressForOwner,
  savePortServiceAddressForOwner,
} from "@/lib/port-service-address"
import { validatePortServiceAddress } from "@/lib/port-address-validation"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can manage service address" }, { status: 403 })
  }

  try {
    const organizationId = req.nextUrl.searchParams.get("organization_id")
    const [fields, validation] = await Promise.all([
      getPortServiceAddressForOwner(userId, organizationId),
      validatePortServiceAddress(userId, organizationId),
    ])
    return NextResponse.json({
      data: {
        ...fields,
        port_ready: validation.ok,
      },
    })
  } catch (e) {
    console.error("[GET /api/numbers/port/service-address]", e)
    return NextResponse.json({ error: "Could not load service address" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can save service address" }, { status: 403 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      organization_id?: string
      legal_business_name?: string
      street?: string
      city?: string
      state?: string
      postal_code?: string
    }

    const result = await savePortServiceAddressForOwner(userId, {
      organization_id: body.organization_id,
      legal_business_name: body.legal_business_name,
      street: String(body.street ?? ""),
      city: String(body.city ?? ""),
      state: String(body.state ?? ""),
      postal_code: String(body.postal_code ?? ""),
    })

    return NextResponse.json({
      success: true,
      message: "Service address saved — you can submit your port request now.",
      data: { registration: result.registration },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save service address"
    console.error("[POST /api/numbers/port/service-address]", e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
