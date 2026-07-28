// GET /rv/{token} — branded review interstitial (records click, then continues to Google).
// SMS URLs stay https://lyncr.app/rv/{token} — no account login required.

import { CustomerPortalReview } from "@/components/customer-portal-review"
import { resolveReviewTokenForPortal } from "@/lib/review-link-token"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ token: string }> }

export default async function ReviewTokenPage({ params }: PageProps) {
  const { token } = await params
  const resolved = await resolveReviewTokenForPortal(token || "")

  if (!resolved?.destinationUrl || !/^https?:\/\//i.test(resolved.destinationUrl)) {
    return (
      <CustomerPortalReview
        destinationUrl=""
        businessName={resolved?.businessName ?? null}
        invalid
      />
    )
  }

  return (
    <CustomerPortalReview
      destinationUrl={resolved.destinationUrl}
      businessName={resolved.businessName}
    />
  )
}
