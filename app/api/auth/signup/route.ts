// ============================================
// POST /api/auth/signup
// ============================================
// Creates a user row and routing_config, then sets session cookie.

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { createUser } from "@/lib/db"
import { defaultProfileFromUserIndustry } from "@/lib/business-industries"
import {
  createSessionCookie,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth"
import { isPlatformAdminUser } from "@/lib/platform-admin"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = String(body?.email ?? "").trim().toLowerCase()
    const password = String(body?.password ?? "")
    const name = String(body?.name ?? "").trim()
    const phone = String(body?.phone ?? "").trim()
    const business_name = String(body?.business_name ?? "").trim()
    const industry = defaultProfileFromUserIndustry(body?.industry)

    if (!email || !password || !name || !phone) {
      return NextResponse.json(
        { error: "Email, password, name, and phone are required" },
        { status: 400 }
      )
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      )
    }

    const password_hash = await bcrypt.hash(password, 10)
    const user = await createUser({
      email,
      name,
      phone: normalizePhone(phone),
      business_name: business_name || "My Business",
      industry,
      password_hash,
    })

    const cookieValue = createSessionCookie(user.id)
    const res = NextResponse.json({
      data: { user, operator_access: isPlatformAdminUser(user) },
    })
    res.cookies.set(getSessionCookieName(), cookieValue, getSessionCookieOptions())
    return res
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      )
    }
    // Helpful message when database or schema is not set up
    if (msg.includes("DATABASE_URL is not set")) {
      return NextResponse.json(
        { error: "Database not configured. Add DATABASE_URL in Vercel → Settings → Environment Variables." },
        { status: 500 }
      )
    }
    if (msg.includes("does not exist") || (msg.includes("relation") && msg.includes("users"))) {
      return NextResponse.json(
        { error: "Database schema missing. In Neon SQL Editor run: 001-create-schema.sql then 002-add-password-hash.sql" },
        { status: 500 }
      )
    }
    if (msg.includes("industry") && (msg.includes("column") || msg.includes("does not exist"))) {
      return NextResponse.json(
        {
          error:
            "Database needs migration: in Neon SQL Editor run scripts/011-user-industry.sql (adds industry for AI scripts).",
        },
        { status: 500 }
      )
    }
    console.error("[Sigo] Signup error:", error)
    const safeMessage =
      process.env.NODE_ENV === "development" ? msg || "Failed to create account" : "Failed to create account"
    return NextResponse.json(
      { error: safeMessage },
      { status: 500 }
    )
  }
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return phone.startsWith("+") ? phone : `+${digits}`
}
