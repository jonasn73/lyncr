import {
  getPhoneNumbers,
  getRoutingConfigForNumber,
  getUser,
  getOnboardingProfile,
  effectiveAdminRoutingOverrideForPhoneLine,
  listOwnerActivePipelineJobsForDay,
  listOwnerUnassignedPoolJobs,
} from "@/lib/db"
import { isDashboardVisibleLineStatus, type DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { dayKeyLocal } from "@/lib/scheduler-utils"
import { requireSessionUser } from "@/lib/server/require-session-user"
import type { ActivePipelineJob, FallbackType, PhoneNumberRoutingSummary, UnassignedPoolJob } from "@/lib/types"
import type { User } from "@/lib/types"

async function mapBusinessNumbers(userId: string): Promise<DashboardBusinessNumber[]> {
  const [numbers, account, profile] = await Promise.all([
    getPhoneNumbers(userId, null),
    getUser(userId),
    getOnboardingProfile(userId),
  ])
  const assistantLinked = Boolean(account?.telnyx_ai_assistant_id?.trim())

  const numbersWithRouting = await Promise.all(
    numbers.map(async (row) => {
      const cfg = await getRoutingConfigForNumber(userId, row.number)
      const fb = (cfg?.fallback_type ?? "owner") as FallbackType
      const aiSelected = fb === "ai"
      const routing_summary: PhoneNumberRoutingSummary = {
        fallback_type: fb,
        ai_fallback_selected: aiSelected,
        telnyx_assistant_linked: assistantLinked,
        ai_fallback_live: aiSelected && assistantLinked,
        ring_first_receptionist_id: cfg?.selected_receptionist_id ?? null,
      }
      return {
        number: row.number,
        status: row.status,
        label: row.label ?? undefined,
        organization_id: row.organization_id ?? null,
        industry_tag: row.industry_tag ?? null,
        source_provider: row.source_provider === "external" ? ("external" as const) : ("telnyx" as const),
        routing_summary,
        admin_routing_override_phone: effectiveAdminRoutingOverrideForPhoneLine(row),
      } satisfies DashboardBusinessNumber
    })
  )

  return numbersWithRouting.filter((n) => isDashboardVisibleLineStatus(n.status))
}

/** Non-blocking promise for phone lines (streamed via Suspense). */
export function phoneLinesPromise(): Promise<DashboardBusinessNumber[]> {
  return requireSessionUser().then((user) => mapBusinessNumbers(user.id))
}

/** Non-blocking promise for hopper jobs. */
export function jobPoolPromise(user?: User): Promise<UnassignedPoolJob[]> {
  const load = async (owner: User) =>
    listOwnerUnassignedPoolJobs({ ownerUserId: owner.id, organizationId: null })
  return user ? load(user) : requireSessionUser().then(load)
}

/** Non-blocking promise for today's active pipeline. */
export function activePipelinePromise(user?: User, dayKey?: string): Promise<ActivePipelineJob[]> {
  const key = dayKey ?? dayKeyLocal(new Date())
  const load = async (owner: User) =>
    listOwnerActivePipelineJobsForDay({
      ownerUserId: owner.id,
      dayKey: key,
      organizationId: null,
    })
  return user ? load(user) : requireSessionUser().then(load)
}
