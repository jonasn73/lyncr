// POST /api/auth/register-invited — complete a receptionist profile from an invite token.
//
// Body: { token, name, password, phone }
// Tries (in order): users invite stub (054), invitations table (053), team_invites (041).
// team_invites path sets a session cookie and lands on /receptionist.

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { registerInvitedReceptionist } from "@/lib/invitations"
import { activateReceptionistInviteStub } from "@/lib/receptionist-invite-stub"
import { acceptReceptionistInviteRegistration, getTeamInviteByToken } from "@/lib/db"
import {
  createSessionCookie,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth"
import { postAuthPayload } from "@/lib/post-auth-redirect"
import { getPendingAgreementForInvite } from "@/lib/agreements/store"
import { finalizeSignedAgreement } from "@/lib/agreements/finalize"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const token = String(body.token ?? "").trim()
    const name = String(body.name ?? body.full_name ?? body.fullName ?? "").trim()
    const phone = String(body.phone ?? "").trim()
    const password = String(body.password ?? "")
    const email = String(body.email ?? "").trim()

    if (!token) return NextResponse.json({ error: "Missing invitation token" }, { status: 400 })
    if (name.length < 2) return NextResponse.json({ error: "Enter your full name" }, { status: 400 })
    if (phone.replace(/\D/g, "").length < 10) {
      return NextResponse.json({ error: "Enter a valid cell phone number" }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }

    // Hash with bcrypt — same pattern as the rest of our auth (see /api/auth/register, login).
    const passwordHash = await bcrypt.hash(password, 10)

    // Email invites activate an existing `users` stub (migration 054); SMS/legacy invites insert
    // fresh rows via the invitations-table flow. Try the stub first, then fall back.
    const stub = await activateReceptionistInviteStub({ token, name, phone, passwordHash })
    if (stub) {
      return NextResponse.json({ data: { user_id: stub.userId, redirect: "/login" } })
    }

    // Owner team invites (and some admin channel invites) live on team_invites.
    const teamInvite = await getTeamInviteByToken(token)
    if (teamInvite) {
      // An invite carrying terms cannot be redeemed without agreeing to them. Checked
      // before the account exists, so a refusal leaves nothing half-created.
      const pending = await getPendingAgreementForInvite(teamInvite.id)
      const signerName = String(body.signer_name ?? name).trim()
      const consent = body.consent_electronic === true
      if (pending && !consent) {
        return NextResponse.json(
          { error: "Read the agreement and agree to sign electronically to continue." },
          { status: 400 }
        )
      }

      const { user } = await acceptReceptionistInviteRegistration({
        token,
        full_name: name,
        phone,
        password_hash: passwordHash,
        email: email || null,
      })

      if (pending) {
        // Signed, then the plan is built from the components the agreement carries —
        // so the plan cannot say something the signed document does not.
        await finalizeSignedAgreement({
          agreement: pending,
          user,
          signerName,
          signatureData: String(body.signature_data ?? signerName),
          signatureType: body.signature_data ? "DRAWN" : "TYPED",
          ip:
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            req.headers.get("x-real-ip") ||
            null,
          userAgent: req.headers.get("user-agent"),
        }).catch((e) => {
          // The account exists and the signature is the record that matters; a failure
          // to attach the plan is recoverable from the Team page.
          console.error("[lyncr] finalize agreement:", e)
        })
      }
      const authMeta = postAuthPayload(user)
      const res = NextResponse.json({
        data: {
          user_id: user.id,
          user,
          ...authMeta,
          // Prefer receptionist home after owner invite redeem.
          redirect: "/receptionist",
        },
      })
      res.cookies.set(getSessionCookieName(), createSessionCookie(user.id), getSessionCookieOptions())
      return res
    }

    const registered = await registerInvitedReceptionist({ token, name, phone, passwordHash })
    // Account created — send them to sign in with their new credentials.
    return NextResponse.json({ data: { user_id: registered.userId, redirect: "/login" } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes("Invite")) return NextResponse.json({ error: msg }, { status: 400 })
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json(
        { error: "An account for this email or number already exists. Try logging in." },
        { status: 409 }
      )
    }
    console.error("[lyncr] register-invited:", error)
    return NextResponse.json({ error: "Failed to complete registration" }, { status: 500 })
  }
}
