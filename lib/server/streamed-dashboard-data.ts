import {
  getAllRoutingConfigs,
  getPhoneNumbers,
  effectiveAdminRoutingOverrideForPhoneLine,
  listOwnerActivePipelineJobsForDay,
  listOwnerUnassignedPoolJobs,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { isDashboardVisibleLineStatus, type DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { dayKeyLocal } from "@/lib/scheduler-utils"
import { requireSessionUser } from "@/lib/server/require-session-user"
import type {
  ActivePipelineJob,
  FallbackType,
  PhoneNumberRoutingSummary,
  RoutingConfig,
  UnassignedPoolJob,
  User,
} from "@/lib/types"

function phoneDigitsKey(phone: string): string {
  return normalizePhoneNumberE164(phone).replace(/\D/g, "")
}

function defaultRoutingConfig(configs: RoutingConfig[]): RoutingConfig | null {
  return configs.find((c) => c.business_number == null) ?? null
}

function mergePerNumberFromDefault(cfg: RoutingConfig, def: RoutingConfig | null): RoutingConfig {
  if (cfg.business_number == null) return cfg
  return {
    ...cfg,
    ai_ring_owner_first: Boolean(def?.ai_ring_owner_first),
    selected_receptionist_id:
      cfg.selected_receptionist_id != null && String(cfg.selected_receptionist_id).trim() !== ""
        ? cfg.selected_receptionist_id
        : def?.selected_receptionist_id ?? null,
  }
}

function routingForNumber(businessNumber: string, configs: RoutingConfig[]): RoutingConfig | null {
  const normalizedBn = normalizePhoneNumberE164(businessNumber)
  const digitKey = phoneDigitsKey(businessNumber)
  const def = defaultRoutingConfig(configs)

  const exact = configs.find(
    (c) =>
      c.business_number != null &&
      (c.business_number === businessNumber || c.business_number === normalizedBn)
  )
  if (exact) return mergePerNumberFromDefault(exact, def)

  if (digitKey.length < 10) return def

  const loose = configs.find((c) => {
    if (!c.business_number) return false
    const rowKey = phoneDigitsKey(c.business_number)
    if (rowKey === digitKey) return true
    return rowKey.length >= 10 && digitKey.length >= 10 && rowKey.slice(-10) === digitKey.slice(-10)
  })
  if (loose) return mergePerNumberFromDefault(loose, def)

  return def
}

async function mapBusinessNumbers(userId: string, account?: User | null): Promise<DashboardBusinessNumber[]> {
  const [numbers, allConfigs] = await Promise.all([
    getPhoneNumbers(userId, null),
    getAllRoutingConfigs(userId),
  ])
  const assistantLinked = Boolean(account?.telnyx_ai_assistant_id?.trim())

  const numbersWithRouting = numbers.map((row) => {
    const cfg = routingForNumber(row.number, allConfigs)
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

  return numbersWithRouting.filter((n) => isDashboardVisibleLineStatus(n.status))
}

/** Non-blocking promise for phone lines (streamed via Suspense). */
export function phoneLinesPromise(user?: User): Promise<DashboardBusinessNumber[]> {
  if (user) return mapBusinessNumbers(user.id, user)
  return requireSessionUser().then((u) => mapBusinessNumbers(u.id, u))
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
  return user ? load(owner) : requireSessionUser().then(load)
}
