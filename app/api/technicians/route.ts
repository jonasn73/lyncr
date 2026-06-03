// ============================================
// GET  /api/technicians   — list the owner's field techs
// POST /api/technicians   — provision a new field tech login + roster row
// ============================================

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  createUser,
  getAuthUserByEmail,
  getUser,
  insertFieldTechnician,
  listFieldTechnicians,
} from "@/lib/db"

export const dynamic = "force-dynamic"

/** Readable temporary password, e.g. "Lyncr-7F3K9Q". */
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no ambiguous chars
  let s = ""
  for (let i = 0; i < 7; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `Lyncr-${s}`
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  try {
    const technicians = await listFieldTechnicians(userId)
    return NextResponse.json({ data: technicians })
  } catch (e) {
    console.error("[GET /api/technicians] failed:", e)
    return NextResponse.json({ error: "Failed to list technicians" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const owner = await getUser(userId)
  if (!owner || owner.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can add technicians" }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    phone?: string
    email?: string
    password?: string
  }
  const name = String(body.name || "").trim()
  const phone = String(body.phone || "").trim()
  const email = String(body.email || "").trim().toLowerCase()
  if (!name || !email) {
    return NextResponse.json({ error: "Name and email are required" }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 })
  }

  // No duplicate logins.
  const existing = await getAuthUserByEmail(email)
  if (existing) {
    return NextResponse.json({ error: "That email already has a Lyncr login" }, { status: 409 })
  }

  const tempPassword = (body.password || "").trim() || generateTempPassword()
  if (tempPassword.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 })
  }

  try {
    const passwordHash = await bcrypt.hash(tempPassword, 10)
    // The tech's login account — same business name so branding carries through.
    const techUser = await createUser({
      email,
      name,
      phone: phone || owner.phone || "+10000000000",
      business_name: owner.business_name,
      password_hash: passwordHash,
      account_role: "field_tech",
    })
    const technician = await insertFieldTechnician({
      owner_user_id: userId,
      portal_user_id: techUser.id,
      name,
      phone,
    })

    // Credentials are returned ONCE so the owner can hand them to the tech.
    return NextResponse.json({
      data: {
        technician,
        credentials: { email, password: tempPassword, login_url: "/tech/login" },
      },
    })
  } catch (e) {
    console.error("[POST /api/technicians] failed:", e)
    return NextResponse.json({ error: "Could not provision technician" }, { status: 500 })
  }
}
