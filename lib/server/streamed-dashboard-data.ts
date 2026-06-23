import {
  effectiveAdminRoutingOverrideForPhoneLine,
  listOwnerActivePipelineJobsForDay,
  listOwnerUnassignedPoolJobs,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { isDashboardVisibleLineStatus, type DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import type { DashboardRoutingBootstrap } from "@/lib/dashboard-stream-types"
import { dayKeyLocal } from "@/lib/scheduler-utils"
import { requireSessionUser } from "@/lib/server/require-session-user"
import {
  getCachedAllRoutingConfigs,
  getCachedOrganizations,
  getCachedPhoneNumbers,
  getCachedReceptionists,
} from "@/lib/server/cached-db"
import type {
  ActivePipelineJob,
  FallbackType,
  Organization,
  PhoneNumberRoutingSummary,
  RoutingConfig,
  UnassignedPoolJob,
  User,
} from "@/lib/types"

export type { DashboardRoutingBootstrap } from "@/lib/dashboard-stream-types"

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
    getCachedPhoneNumbers(userId),
    getCachedAllRoutingConfigs(userId),
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

function mapRoutingFields(cfg: RoutingConfig | null): DashboardRoutingBootstrap["routing"] {
  const strat = cfg?.routing_strategy
  return {
    selected_receptionist_id: cfg?.selected_receptionist_id ?? null,
    fallback_type: (cfg?.fallback_type ?? "owner") as FallbackType,
    ai_ring_owner_first: Boolean(cfg?.ai_ring_owner_first),
    ring_timeout_seconds:
      typeof cfg?.ring_timeout_seconds === "number" && Number.isFinite(cfg.ring_timeout_seconds)
        ? cfg.ring_timeout_seconds
        : 30,
    routing_strategy:
      strat === "private_only" || strat === "lyncr_only" || strat === "hybrid_fallback"
        ? strat
        : "private_only",
    allow_lyncr_network_fallback: Boolean(cfg?.allow_lyncr_network_fallback),
  }
}

async function loadRoutingBootstrap(user: User): Promise<DashboardRoutingBootstrap> {
  const [receptionists, numbers, configs] = await Promise.all([
    getCachedReceptionists(user.id),
    getCachedPhoneNumbers(user.id),
    getCachedAllRoutingConfigs(user.id),
  ])
  const visible = numbers.filter((n) => isDashboardVisibleLineStatus(n.status))
  const primaryLine = visible[0]?.number ?? null
  const cfg = primaryLine ? routingForNumber(primaryLine, configs) : defaultRoutingConfig(configs)

  return {
    ownerPhone: user.phone ?? null,
    receptionists: receptionists.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      initials: r.initials?.trim() || r.name.slice(0, 2).toUpperCase() || "??",
      color: r.color?.trim() || "bg-primary",
    })),
    routing: mapRoutingFields(cfg),
    primaryLineNumber: primaryLine,
  }
}

/** Non-blocking promise for phone lines (streamed via Suspense). */
export function phoneLinesPromise(user?: User): Promise<DashboardBusinessNumber[]> {
  if (user) return mapBusinessNumbers(user.id, user)
  return requireSessionUser().then((u) => mapBusinessNumbers(u.id, u))
}

/** Non-blocking promise for the header workspace switcher. */
export function organizationsPromise(user?: User): Promise<Organization[]> {
  if (user) return getCachedOrganizations(user.id)
  return requireSessionUser().then((u) => getCachedOrganizations(u.id))
}

/** Session + team + routing for the call-flow panel (streamed via Suspense). */
export function routingBootstrapPromise(user?: User): Promise<DashboardRoutingBootstrap> {
  if (user) return loadRoutingBootstrap(user)
  return requireSessionUser().then(loadRoutingBootstrap)
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
