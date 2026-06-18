// GET /api/vehicle/models?make=Ford&year=2021

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { fetchModelsForMakeYear } from "@/lib/nhtsa-vpic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const make = req.nextUrl.searchParams.get("make")?.trim() ?? ""
  const yearRaw = req.nextUrl.searchParams.get("year")?.trim() ?? ""
  const year = Number(yearRaw)
  if (!make || !Number.isFinite(year) || year < 1980) {
    return NextResponse.json({ error: "make and year are required" }, { status: 400 })
  }

  try {
    const models = await fetchModelsForMakeYear(make, year)
    return NextResponse.json({ data: { models } })
  } catch (e) {
    console.error("[vehicle/models]", e)
    return NextResponse.json({ data: { models: [] as string[] } })
  }
}
