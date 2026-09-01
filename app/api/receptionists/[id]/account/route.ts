// ============================================
// PATCH /api/receptionists/[id]/account
// ============================================
// Owner-only account controls on the receptionist's LOGIN row (users), not the roster row:
// lock/unlock (blocks sign-in — see /api/auth/login and getSessionUser), a real contact email
// (users.contact_email — separate from the login email), and setting a new password directly.

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { getUserIdFromRequest } from "@/lib/auth"
import { getReceptionist, setAccountLocked, setUserContactEmail, setUserPasswordHash } from "@/lib/db"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await params
  const existing = await getReceptionist(id)
  if (!existing || existing.user_id !== userId) {
    return NextResponse.json({ error: "Receptionist not found" }, { status: 404 })
  }
  const portalUserId = existing.portal_user_id
  if (!portalUserId) {
    return NextResponse.json({ error: "This receptionist has not finished setting up their login yet" }, { status: 400 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      account_locked?: boolean
      contact_email?: string | null
      new_password?: string
    }

    if (typeof body.account_locked === "boolean") {
      await setAccountLocked(portalUserId, body.account_locked)
    }
    if (body.contact_email !== undefined) {
      const trimmed = typeof body.contact_email === "string" ? body.contact_email.trim() : ""
      if (trimmed && !trimmed.includes("@")) {
        return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 })
      }
      await setUserContactEmail(portalUserId, trimmed || null)
    }
    if (typeof body.new_password === "string" && body.new_password.length > 0) {
      if (body.new_password.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
      }
      const hash = await bcrypt.hash(body.new_password, 10)
      await setUserPasswordHash(portalUserId, hash)
    }

    const updated = await getReceptionist(id)
    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error("[lyncr] Update receptionist account error:", error)
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 })
  }
}
