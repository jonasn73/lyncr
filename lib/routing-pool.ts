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
import { normalizeRoutingPoolSkillTag, type RoutingPoolMode } from "@/lib/routing-pool-skills"
import { resolveInboundPstnForwardAnswerOnBridge } from "@/lib/inbound-branded-greeting"
import {
  buildRoutingPoolDialTexml,
  finalizeInboundTexmlXml,
} from "@/lib/telnyx-inbound-media-quality"
import { resolveBusinessType } from "@/lib/business-type"
import { buildReceptionistAnswerUrl } from "@/lib/receptionist-answer-url"

/**
 * Relevance rank of an agent's skills against the line tag (lower = better, rings first).
 *   0 → the agent carries the exact tag as a skill (e.g. line "detailing_core" / agent "detailing_core")
 *   1 → the line tag is one of a skill's underscore tokens (line "detailing" / agent "auto_detailing")
 *   2 → only the base family lines up (line "auto_wash" / agent "auto_detailing")
 *   3 → matched some other way (defensive; keeps a stable order)
 * This mirrors the SQL match so the dial order prioritizes the most specifically-skilled agents.
 */
function skillMatchRank(skills: string[], tag: string): number {
  const slugs = skills.map((s) => normalizeRoutingPoolSkillTag(s)).filter(Boolean)
  if (slugs.includes(tag)) return 0
  if (slugs.some((s) => s.split("_").includes(tag))) return 1
  const tagBase = tag.split("_")[0]
  if (slugs.some((s) => s.split("_")[0] === tagBase)) return 2
  return 3
}

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

  // Prioritize the most specifically-skilled agents so they ring first (esp. for sequential dialing).
  receptionists = receptionists
    .slice()
    .sort(
      (a, b) =>
        skillMatchRank(a.skills, industryTag) - skillMatchRank(b.skills, industryTag) ||
        a.name.localeCompare(b.name)
    )

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
    callLogId?: string | null
    callerNumber?: string | null
    callerName?: string | null
    businessName?: string | null
  }
  /** Branded caller greeting spoken before `<Dial>`. */
  callerGreeting?: string
  includeRingback?: boolean
  /** When true, pass-1 greeting already played — cell forward must not restore caller ringback. */
  greetingPassDone?: boolean
  /** Per-line dashboard toggle — straight ring when false. */
  greetingEnabled?: boolean
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
        ownerUserId: params.match.line.user_id,
        toNumber: params.match.line.number,
        receptionistId: r.id,
        callSid: params.answer.callSid,
        callLogId: params.answer.callLogId,
        businessType,
        callerNumber: params.answer.callerNumber,
        callerName: params.answer.callerName,
        businessName: params.answer.businessName ?? params.match.line.label ?? null,
      })
    }
  }
  const xml = buildRoutingPoolDialTexml({
    ...(params.callerId && isReasonablePstnDialString(params.callerId) ? { callerId: params.callerId } : {}),
    answerOnBridge: resolveInboundPstnForwardAnswerOnBridge(
      params.greetingPassDone ?? false,
      params.greetingEnabled ?? true
    ),
    timeout: params.timeout,
    action: params.action,
    receptionistE164List: params.match.dial_targets,
    mode: params.match.routing_pool_mode,
    ...(answerUrlByE164 ? { answerUrlByE164 } : {}),
    ...(params.callerGreeting?.trim() ? { callerGreeting: params.callerGreeting.trim() } : {}),
    includeRingback: params.includeRingback,
  })
  return finalizeInboundTexmlXml(xml)
}
