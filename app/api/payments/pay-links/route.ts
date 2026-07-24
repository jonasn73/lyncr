// GET /api/payments/pay-links?jobId=… — list sent pay links + live Stripe/wallet status
// POST /api/payments/pay-links — sync one session/token (or all links for a job) into the wallet

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser, listCollectPayLinksByJobId, listCollectPayLinksForOwner } from "@/lib/db"
import { isStripeConfigured } from "@/lib/stripe-config"
import {
  syncCollectPayLinkStatus,
  syncCollectPayLinksForJob,
  type CollectPayLinkStatus,
} from "@/lib/job-pay-link"
import { getJobPaymentContext } from "@/lib/job-payments"
import { getAppUrl } from "@/lib/telnyx"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function fmtRow(
  row: Awaited<ReturnType<typeof listCollectPayLinksByJobId>>[number],
  live?: CollectPayLinkStatus | null
): CollectPayLinkStatus {
  const appUrl = getAppUrl().replace(/\/$/, "")
  if (live) return live
  const expired = new Date(row.expires_at).getTime() < Date.now()
  return {
    token: row.token,
    url: `${appUrl}/pay/${row.token}`,
    stripeSessionId: row.stripe_session_id,
    jobId: row.job_id,
    chargeCents: row.charge_cents,
    customerName: row.customer_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    paymentStatus: expired ? "expired" : "unknown",
    walletSettled: false,
    fulfilledNow: false,
  }
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const jobId = (req.nextUrl.searchParams.get("jobId") || "").trim()
  const sync = req.nextUrl.searchParams.get("sync") === "1"
  const ownerUserId = userId

  if (jobId) {
    const job = await getJobPaymentContext(jobId)
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })
    const isTech = job.assignedTechId === userId
    const isOwner = job.ownerUserId === userId
    if (!isTech && !isOwner) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 })
    }
    const listOwnerId = job.ownerUserId
    if (sync && isStripeConfigured()) {
      const links = await syncCollectPayLinksForJob(listOwnerId, jobId)
      return NextResponse.json({ data: { links } })
    }
    const rows = await listCollectPayLinksByJobId(listOwnerId, jobId, 20)
    return NextResponse.json({
      data: { links: rows.map((r) => fmtRow(r)) },
    })
  }

  // Recent links for this owner account (Collect Payment list badges).
  const rows = await listCollectPayLinksForOwner(ownerUserId, 40)
  if (sync && isStripeConfigured()) {
    const links: CollectPayLinkStatus[] = []
    for (const row of rows.slice(0, 15)) {
      const live = await syncCollectPayLinkStatus({
        token: row.token,
        stripeSessionId: row.stripe_session_id,
      })
      links.push(fmtRow(row, live))
    }
    return NextResponse.json({ data: { links } })
  }

  return NextResponse.json({
    data: { links: rows.map((r) => fmtRow(r)) },
  })
}

type PostBody = {
  jobId?: string
  token?: string
  sessionId?: string
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 })
  }

  const body = (await req.json().catch(() => ({}))) as PostBody
  const jobId = String(body.jobId ?? "").trim()
  const token = String(body.token ?? "").trim()
  const sessionId = String(body.sessionId ?? "").trim()

  if (jobId) {
    const job = await getJobPaymentContext(jobId)
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })
    if (job.ownerUserId !== userId && job.assignedTechId !== userId) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 })
    }
    const links = await syncCollectPayLinksForJob(job.ownerUserId, jobId)
    return NextResponse.json({ data: { links } })
  }

  if (!token && !sessionId) {
    return NextResponse.json(
      { error: "Provide jobId, token, or sessionId" },
      { status: 400 }
    )
  }

  const link = await syncCollectPayLinkStatus({ token, stripeSessionId: sessionId })
  if (!link) {
    return NextResponse.json({ error: "Pay link not found" }, { status: 404 })
  }

  // Only the business that owns the link (or assigned tech) may sync it from the app.
  const { getCollectPayLinkBySessionId } = await import("@/lib/db")
  const stored = await getCollectPayLinkBySessionId(link.stripeSessionId)
  if (stored?.owner_user_id && stored.owner_user_id !== userId) {
    if (link.jobId) {
      const job = await getJobPaymentContext(link.jobId)
      if (!job || (job.ownerUserId !== userId && job.assignedTechId !== userId)) {
        return NextResponse.json({ error: "Not allowed" }, { status: 403 })
      }
    } else if (stored.acting_user_id !== userId) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 })
    }
  } else if (link.jobId) {
    const job = await getJobPaymentContext(link.jobId)
    if (
      job &&
      job.ownerUserId !== userId &&
      job.assignedTechId !== userId
    ) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 })
    }
  }

  return NextResponse.json({ data: { link } })
}
