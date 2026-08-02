// GET/PUT /api/settings/sales-tax — Collect/Charge default sales tax.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import {
  getSalesTaxSettings,
  updateSalesTaxSettings,
} from "@/lib/sales-tax-settings"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const settings = await getSalesTaxSettings(userId)
  return NextResponse.json({
    data: {
      enabledDefault: settings.enabledDefault,
      ratePercent: settings.ratePercent,
      sales_tax_enabled_default: settings.enabledDefault,
      sales_tax_rate_percent: settings.ratePercent,
    },
  })
}

export async function PUT(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  if (user.account_role === "field_tech") {
    return NextResponse.json(
      { error: "Only the business owner can change tax defaults." },
      { status: 403 }
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    enabledDefault?: boolean
    ratePercent?: number
    sales_tax_enabled_default?: boolean
    sales_tax_rate_percent?: number
  }

  const enabledDefault =
    typeof body.enabledDefault === "boolean"
      ? body.enabledDefault
      : typeof body.sales_tax_enabled_default === "boolean"
        ? body.sales_tax_enabled_default
        : undefined
  const ratePercent =
    body.ratePercent != null
      ? Number(body.ratePercent)
      : body.sales_tax_rate_percent != null
        ? Number(body.sales_tax_rate_percent)
        : undefined

  try {
    const saved = await updateSalesTaxSettings(userId, {
      enabledDefault,
      ratePercent: Number.isFinite(ratePercent as number) ? (ratePercent as number) : undefined,
    })
    return NextResponse.json({
      data: {
        enabledDefault: saved.enabledDefault,
        ratePercent: saved.ratePercent,
        sales_tax_enabled_default: saved.enabledDefault,
        sales_tax_rate_percent: saved.ratePercent,
      },
    })
  } catch (e) {
    const err = e as Error & { code?: string }
    if (err.code === "SALES_TAX_MIGRATION_REQUIRED") {
      return NextResponse.json(
        { error: err.message, migration: "scripts/123-sales-tax-defaults.sql" },
        { status: 503 }
      )
    }
    console.error("[PUT /api/settings/sales-tax]", e)
    return NextResponse.json(
      { error: err.message || "Could not save tax settings" },
      { status: 500 }
    )
  }
}
