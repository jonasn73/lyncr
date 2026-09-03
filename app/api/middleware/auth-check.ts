// Service-context authorization for authenticated API routes.

import { NextRequest, NextResponse } from "next/server"
import { requireSessionUser, type SessionUserContext } from "@/lib/admin-api-guard"
import { getOnboardingProfile } from "@/lib/db"
import {
  buildServiceContext,
  hasPremiumCapability,
  type PremiumCapability,
  type ServiceContext,
} from "@/lib/service-context"
import type { SubscriptionTier } from "@/lib/subscription-tier"

export type AuthenticatedServiceContext = {
  session: SessionUserContext
  service: ServiceContext
}

/** Loads session user + tier capabilities (includes master test-account bypass). */
export async function resolveAuthenticatedServiceContext(
  req: NextRequest
): Promise<AuthenticatedServiceContext | NextResponse> {
  const session = await requireSessionUser(req)
  if (session instanceof NextResponse) return session
  const profile = await getOnboardingProfile(session.userId)
  const service = buildServiceContext(session.user, profile)
  return { session, service }
}

/** Returns 403 JSON when the account lacks a premium capability (unless master bypass). */
export function requirePremiumCapability(
  service: ServiceContext,
  capability: PremiumCapability,
  message: string
): NextResponse | null {
  if (service.capabilities[capability]) return null
  return NextResponse.json(
    {
      error: message,
      upgrade_required: true,
      capability,
      subscription_tier: service.subscription_tier,
    },
    { status: 403 }
  )
}

