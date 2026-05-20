// ============================================
// POST /api/auth/repair-bootstrap-admin
// ============================================
// One-time production fix: sets bcrypt password + platform admin for the bootstrap email
// without pasting hashes into Neon. Requires `ZING_BOOTSTRAP_ADMIN_SECRET` (24+ chars) in
// Vercel and the same value in JSON `{ "secret": "..." }`. Remove the env var after use.

import { createHash, timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { repairBootstrapPlatformAdminAccount } from "@/lib/db"

function sha256Utf8(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest()
}

function bootstrapSecretsMatch(attempt: string, expected: string): boolean {
  const a = sha256Utf8(attempt)
  const b = sha256Utf8(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const expected = process.env.ZING_BOOTSTRAP_ADMIN_SECRET?.trim()
  if (!expected || expected.length < 24) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  let body: { secret?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }

  const attempt = String(body?.secret ?? "")
  if (!bootstrapSecretsMatch(attempt, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const email = (process.env.ZING_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || "admin@lyncr.app").toLowerCase()
  const passwordPlain = process.env.ZING_BOOTSTRAP_ADMIN_TEMP_PASSWORD?.trim() || "admin"

  try {
    const passwordHash = await bcrypt.hash(passwordPlain, 10)
    const result = await repairBootstrapPlatformAdminAccount({ email, passwordHash })
    return NextResponse.json({
      data: {
        ok: true,
        email,
        created: result.created,
        message:
          "Login with this email and password, then remove ZING_BOOTSTRAP_ADMIN_SECRET from Vercel.",
      },
    })
  } catch (e) {
    console.error("[Sigo] repair-bootstrap-admin:", e)
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 })
    }
    return NextResponse.json({ error: "Repair failed" }, { status: 500 })
  }
}
