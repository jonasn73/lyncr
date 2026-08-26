// GET /api/agreements/for-invite?token=… — the agreement an invitee has to sign.
//
// Public by design: the invitee has no account yet, and the invite token is the
// credential. It returns only what the person holding that token is entitled to read —
// the terms addressed to them — and never the token, the owner's id, or anything about
// the rest of the roster.

import { NextRequest, NextResponse } from "next/server"
import { getTeamInviteByToken, getUser } from "@/lib/db"
import { getPendingAgreementForInvite } from "@/lib/agreements/store"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? ""
  if (!token) {
    return NextResponse.json({ error: "Missing invitation token" }, { status: 400 })
  }

  try {
    const invite = await getTeamInviteByToken(token)
    // Same answer for a bad token and a used one — an unauthenticated caller must not
    // be able to probe which tokens exist.
    if (!invite || invite.accepted_at || Date.parse(invite.expires_at) < Date.now()) {
      return NextResponse.json({ data: { agreement: null } })
    }

    const agreement = await getPendingAgreementForInvite(invite.id)
    if (!agreement) return NextResponse.json({ data: { agreement: null } })

    const owner = await getUser(invite.invited_by_user_id).catch(() => null)

    return NextResponse.json({
      data: {
        agreement: {
          id: agreement.id,
          employment_type: agreement.employment_type,
          pay_summary: agreement.pay_summary,
          body: agreement.rendered_body,
          business_name: owner?.business_name?.trim() || "this business",
        },
      },
    })
  } catch (e) {
    console.error("[GET /api/agreements/for-invite]", e)
    return NextResponse.json({ error: "Could not load the agreement" }, { status: 500 })
  }
}
