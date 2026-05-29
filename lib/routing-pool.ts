// Skill-tagged routing pool — match platform receptionists to inbound business lines.

import {
  getLineHybridRoutingStrategy,
  getPhoneNumberLineById,
  isReasonablePstnDialString,
  listAvailableNetworkReceptionistsForIndustryTag,
  listAvailablePlatformReceptionistsForIndustryTag,
  normalizePhoneNumberE164,
  resolveIndustryTagForLine,
  type PlatformRoutingPoolReceptionist,
} from "@/lib/db"
import type { PhoneNumber, RoutingStrategy } from "@/lib/types"
import type { RoutingPoolMode } from "@/lib/routing-pool-skills"
import {
  buildRoutingPoolDialTexml,
  finalizeInboundTexmlXml,
  readInboundFastDialAnswerOnBridge,
} from "@/lib/telnyx-inbound-media-quality"
import { resolveBusinessType } from "@/lib/business-type"
import { buildReceptionistAnswerUrl } from "@/lib/receptionist-answer-url"

export type RoutingPoolMatchResult = {
  line: PhoneNumber
  industry_tag: string
  routing_pool_mode: RoutingPoolMode
  receptionists: PlatformRoutingPoolReceptionist[]
  /** Normalized E.164 numbers ready for Telnyx `<Number>` tags. */
  dial_targets: string[]
  /** `048` strategy that produced this match. */
  routing_strategy: RoutingStrategy
  /** Which pool actually matched — this business's private staff or the shared Lyncr network. */
  matched_scope: "private" | "network"
}

/**
 * Load the active line, resolve its industry tag, and return online receptionists whose skills match,
 * applying the line's `048` hybrid-network strategy:
 *   - `private_only`    → only this business's own staff (receptionists.user_id = line.user_id)
 *   - `lyncr_only`      → only shared global Lyncr network agents (receptionists.user_id IS NULL)
 *   - `hybrid_fallback` → private staff first; drop back to the network pool when none are online
 * `allow_lyncr_network_fallback` permits the network drop-back even for `private_only`.
 */
export async function getAvailableReceptionistsForLine(lineId: string): Promise<RoutingPoolMatchResult | null> {
  const line = await getPhoneNumberLineById(lineId)
  if (!line) return null

  const industryTag = await resolveIndustryTagForLine(line)
  if (!industryTag) return null

  const { routing_strategy, allow_lyncr_network_fallback } = await getLineHybridRoutingStrategy(
    line.user_id,
    line.number
  )

  let receptionists: PlatformRoutingPoolReceptionist[] = []
  let matched_scope: "private" | "network" = "private"

  if (routing_strategy === "lyncr_only") {
    // Bypass private staff entirely — shared Lyncr network agents only (user_id IS NULL).
    receptionists = await listAvailableNetworkReceptionistsForIndustryTag(industryTag)
    matched_scope = "network"
  } else {
    // private_only or hybrid_fallback → this business's own online staff first.
    receptionists = await listAvailablePlatformReceptionistsForIndustryTag(industryTag, {
      scope: "private",
      ownerUserId: line.user_id,
    })
    matched_scope = "private"

    // Drop back to the shared network pool when no private staff are online and fallback is allowed.
    const networkFallbackAllowed = routing_strategy === "hybrid_fallback" || allow_lyncr_network_fallback === true
    if (receptionists.length === 0 && networkFallbackAllowed) {
      receptionists = await listAvailableNetworkReceptionistsForIndustryTag(industryTag)
      matched_scope = "network"
    }
  }

  const dial_targets = receptionists
    .map((r) => normalizePhoneNumberE164(r.phone))
    .filter((e164) => isReasonablePstnDialString(e164))

  if (dial_targets.length === 0) return null

  return {
    line,
    industry_tag: industryTag,
    routing_pool_mode: line.routing_pool_mode ?? "sequential",
    receptionists,
    dial_targets,
    routing_strategy,
    matched_scope,
  }
}

/** Build finalized TeXML that dials the matched receptionist pool for Telnyx call control. */
export function buildRoutingPoolDialResponse(params: {
  match: RoutingPoolMatchResult
  callerId?: string
  timeout: number
  action: string
  /** When provided, each `<Number>` gets a per-receptionist answer `url` for the realtime HUD. */
  answer?: {
    appUrl: string
    callSid: string
    callerNumber?: string | null
    callerName?: string | null
    businessName?: string | null
  }
}): string {
  let answerUrlByE164: Record<string, string> | undefined
  if (params.answer) {
    const businessType = resolveBusinessType(params.match.industry_tag)
    answerUrlByE164 = {}
    for (const r of params.match.receptionists) {
      const e164 = normalizePhoneNumberE164(r.phone)
      if (!isReasonablePstnDialString(e164)) continue
      answerUrlByE164[e164] = buildReceptionistAnswerUrl({
        appUrl: params.answer.appUrl,
        receptionistId: r.id,
        callSid: params.answer.callSid,
        businessType,
        callerNumber: params.answer.callerNumber,
        callerName: params.answer.callerName,
        businessName: params.answer.businessName ?? params.match.line.label ?? null,
      })
    }
  }
  const xml = buildRoutingPoolDialTexml({
    ...(params.callerId && isReasonablePstnDialString(params.callerId) ? { callerId: params.callerId } : {}),
    answerOnBridge: readInboundFastDialAnswerOnBridge(),
    timeout: params.timeout,
    action: params.action,
    receptionistE164List: params.match.dial_targets,
    mode: params.match.routing_pool_mode,
    ...(answerUrlByE164 ? { answerUrlByE164 } : {}),
  })
  return finalizeInboundTexmlXml(xml)
}
