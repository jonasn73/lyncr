// ============================================
// Platform admin — Vercel + Neon + Telnyx infra cost (/admin/infra)
// ============================================
// Read-only cost visibility for the platform's own hosting/database spend, separate
// from lib/admin-business-economics.ts (per-*business* P&L — no infra-cost overlap:
// neither provider's API attributes cost back to an individual Lyncr account).
//
// Both fetchers swallow their own errors and never throw (missing token, network
// error, provider outage) — this is a dashboard, never something that should be able
// to break /admin. But a swallowed error must not look identical to genuine $0 spend
// (that gap is exactly what caused real production confusion once already) — every
// fetcher returns `ok` alongside `categories`, and callers surface `ok: false`
// distinctly in the UI rather than rendering an indistinguishable "$0.00".

import { getTelnyxAccountBalance } from "@/lib/telnyx-billing"

/** One category's cost, from either provider. Neon is always an estimate — see below. */
export type InfraCostByCategory = {
  provider: "vercel" | "neon"
  category: string
  costCents: number
  isEstimate: boolean
}

/** `ok: false` means the call itself failed (bad token, network error, provider outage) — not that spend is $0. */
export type InfraCostFetchResult = {
  ok: boolean
  categories: InfraCostByCategory[]
  /** Set when ok is false — the actual upstream error, shown directly in the UI instead of "check server logs." */
  error?: string
}

/**
 * Pulls a human-readable message out of a provider's JSON error body (both Vercel's
 * `{error:{message}}` and Neon's `{message}` shapes), so the admin UI can show the real
 * upstream reason directly instead of sending someone to check server logs for it.
 */
function extractErrorMessage(status: number, body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: string }; message?: string }
    const msg = json.error?.message?.trim() || json.message?.trim()
    if (msg) return `${status}: ${msg}`
  } catch {
    // not JSON — fall through to the raw body
  }
  const trimmed = body.trim()
  return trimmed ? `${status}: ${trimmed.slice(0, 200)}` : `HTTP ${status}`
}

/** This project's Vercel team — not secret, just an id. Override if the team ever changes. */
const DEFAULT_VERCEL_TEAM_ID = "team_5bOfnmiXSwrfqOVGFkMQudQj"

function resolveVercelTeamId(): string {
  return process.env.VERCEL_TEAM_ID?.trim() || DEFAULT_VERCEL_TEAM_ID
}

/** Cents, defaults to $20/mo — change via Vercel → Environment Variables when the real budget is known. */
export function resolveVercelMonthlyBudgetCents(): number {
  const raw = parseInt(process.env.VERCEL_MONTHLY_BUDGET_CENTS ?? "", 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 2000
}

export function resolveNeonMonthlyBudgetCents(): number {
  const raw = parseInt(process.env.NEON_MONTHLY_BUDGET_CENTS ?? "", 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 2000
}

type VercelFocusChargeLine = {
  BilledCost?: number | string
  ServiceCategory?: string
  ServiceName?: string
}

/**
 * FOCUS v1.3 billing charges — real dollar costs, streamed as JSONL. Verified against
 * Vercel's own docs (not memorized): GET /v1/billing/charges, max 1yr range/1-day
 * granularity, requires teamId.
 */
export async function fetchVercelBillingCharges(range: {
  from: string
  to: string
}): Promise<InfraCostFetchResult> {
  const token = process.env.VERCEL_API_TOKEN?.trim()
  if (!token) return { ok: false, categories: [], error: "VERCEL_API_TOKEN is not set" }
  try {
    const url = new URL("https://api.vercel.com/v1/billing/charges")
    url.searchParams.set("teamId", resolveVercelTeamId())
    url.searchParams.set("from", range.from)
    url.searchParams.set("to", range.to)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      const error = extractErrorMessage(res.status, body)
      console.warn("[admin-infra-cost] Vercel billing charges non-OK:", error)
      return { ok: false, categories: [], error }
    }
    const text = await res.text()
    const totals = new Map<string, number>()
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let row: VercelFocusChargeLine
      try {
        row = JSON.parse(trimmed) as VercelFocusChargeLine
      } catch {
        continue
      }
      const category = row.ServiceCategory?.trim() || row.ServiceName?.trim() || "Other"
      const cost = Number(row.BilledCost ?? 0)
      if (!Number.isFinite(cost)) continue
      totals.set(category, (totals.get(category) ?? 0) + cost)
    }
    return {
      ok: true,
      categories: Array.from(totals.entries()).map(([category, dollars]) => ({
        provider: "vercel" as const,
        category,
        costCents: Math.round(dollars * 100),
        isEstimate: false,
      })),
    }
  } catch (e) {
    console.warn("[admin-infra-cost] fetchVercelBillingCharges failed:", e)
    return { ok: false, categories: [], error: e instanceof Error ? e.message : "Request failed" }
  }
}

type NeonProjectsResponse = { projects?: { id?: string; org_id?: string }[] }
type NeonOrganizationsResponse = { organizations?: { id?: string }[] }
type NeonProjectDetail = {
  id: string
  org_id: string
  /** All four below: current-billing-period totals, reset at the start of each period (Neon docs). */
  data_storage_bytes_hour?: number
  data_transfer_bytes?: number
  compute_time_seconds?: number
  consumption_period_start?: string
}
type NeonSingleProjectResponse = { project?: Partial<NeonProjectDetail> }

/** Logs status + returns a human-readable message (Neon error bodies carry no secrets). */
async function warnNeonNonOk(label: string, res: Response): Promise<string> {
  const body = await res.text().catch(() => "")
  const error = extractErrorMessage(res.status, body)
  console.warn(`[admin-infra-cost] ${label} non-OK:`, error)
  return error
}

/**
 * GET /projects/{id} — works for every Neon key type, including project-scoped keys.
 * Confirmed in production: those refuse the org-wide /projects listing (below) AND the
 * org-wide /consumption_history endpoint (even filtered to just this project id) with
 * "not allowed to perform actions outside the project this key is scoped to" — but this
 * single-project fetch is exactly the scope a project-scoped key is allowed, and it
 * conveniently already carries the current-period usage fields fetchNeonConsumption
 * needs, so there's no second (failing) API call to make for that key type at all.
 */
async function getNeonProjectById(
  key: string,
  projectId: string
): Promise<{ ok: true; project: NeonProjectDetail } | { ok: false; error: string }> {
  const res = await fetch(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  })
  if (!res.ok) {
    return { ok: false, error: await warnNeonNonOk(`Neon get project ${projectId}`, res) }
  }
  const json = (await res.json()) as NeonSingleProjectResponse
  if (!json.project?.id || !json.project.org_id) {
    return { ok: false, error: "Neon get project: response missing id/org_id" }
  }
  return { ok: true, project: json.project as NeonProjectDetail }
}

/**
 * A personal Neon API key can't list /projects without an explicit org_id (org- and
 * project-scoped keys can, but resolving it explicitly works for all three key types,
 * so always do it this way rather than branching on key type).
 */
async function resolveNeonOrgId(key: string): Promise<{ orgId: string | null; error: string | null }> {
  const res = await fetch("https://console.neon.tech/api/v2/users/me/organizations", {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  })
  if (!res.ok) {
    return { orgId: null, error: await warnNeonNonOk("Neon list organizations", res) }
  }
  const json = (await res.json()) as NeonOrganizationsResponse
  return { orgId: json.organizations?.[0]?.id ?? null, error: null }
}

async function listNeonProjects(
  key: string,
  orgId: string | null
): Promise<{ ok: true; projects: NeonProjectsResponse } | { ok: false; error: string }> {
  const url = new URL("https://console.neon.tech/api/v2/projects")
  if (orgId) url.searchParams.set("org_id", orgId)
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  })
  if (!res.ok) {
    return { ok: false, error: await warnNeonNonOk(`Neon list projects (org_id=${orgId ?? "none"})`, res) }
  }
  return { ok: true, projects: (await res.json()) as NeonProjectsResponse }
}

/**
 * Resolves the project (with its current-period usage fields already attached) from just
 * the API key — no manual id entry needed for a personal/org key. NEON_PROJECT_ID, when
 * set, is required for a project-scoped key (the only listing it can ever do is of itself).
 */
export async function resolveNeonProjectDetail(): Promise<
  { ok: true; project: NeonProjectDetail } | { ok: false; error: string }
> {
  const key = process.env.NEON_API_KEY?.trim()
  if (!key) return { ok: false, error: "NEON_API_KEY is not set" }
  try {
    const preferredId = process.env.NEON_PROJECT_ID?.trim()
    let lastError = "Unknown error"
    // Try the direct single-project fetch first when we already have an id — this is the
    // ONLY path a project-scoped key can use, and it works fine for the other key types too.
    if (preferredId) {
      const direct = await getNeonProjectById(key, preferredId)
      if (direct.ok) return direct
      lastError = direct.error
    }

    const orgResult = await (process.env.NEON_ORG_ID?.trim()
      ? Promise.resolve({ orgId: process.env.NEON_ORG_ID.trim(), error: null })
      : resolveNeonOrgId(key))
    const orgId = orgResult.orgId
    if (orgResult.error) lastError = orgResult.error
    // Try with org_id first (required for personal keys per Neon's docs); if that fails
    // and we didn't have an explicit override, retry with no org_id at all — some key
    // types (org-scoped, project-scoped) infer it and can reject an explicit param
    // they don't expect instead of the reverse.
    let listResult = await listNeonProjects(key, orgId)
    if (!listResult.ok) {
      lastError = listResult.error
      if (orgId && !process.env.NEON_ORG_ID?.trim()) {
        listResult = await listNeonProjects(key, null)
        if (!listResult.ok) lastError = listResult.error
      }
    }
    if (!listResult.ok) return { ok: false, error: lastError }
    const projects = listResult.projects.projects ?? []
    const match = preferredId ? projects.find((p) => p.id === preferredId) : projects[0]
    if (!match?.id) return { ok: false, error: "Neon account has no projects" }
    // The listing response doesn't carry usage fields — one more call to get them.
    return await getNeonProjectById(key, match.id)
  } catch (e) {
    const error = e instanceof Error ? e.message : "Request failed"
    console.warn("[admin-infra-cost] resolveNeonProjectDetail failed:", e)
    return { ok: false, error }
  }
}

/** Neon's documented conversion formulas (neon.com/docs/introduction/usage-calculations). */
const CU_SECONDS_PER_HOUR = 3600
const BYTES_PER_GB = 1_000_000_000
/** Average hours/month (365.25 * 24 / 12) — converts an accumulated byte-hour total directly to GB-months. */
const AVG_HOURS_PER_MONTH = 730.5

/**
 * Neon's documented per-unit prices (Launch/Scale tier, USD) — Neon exposes no
 * FOCUS-style cost endpoint, so this is a labeled ESTIMATE, not an invoiced total.
 * Update if Neon's published pricing changes.
 */
const NEON_PRICE = {
  computeUnitHour: 0.106,
  storageGbMonth: 0.35,
  publicTransferGb: 0.1,
}
/** Public data transfer allowance before per-GB charges kick in. */
const NEON_PUBLIC_TRANSFER_FREE_GB = 500

/**
 * Current-billing-period spend, read directly off the project detail object (GET
 * /projects/{id}) rather than the /consumption_history endpoint — confirmed in
 * production that a project-scoped key cannot use consumption_history at all, even
 * filtered to its own project id ("not allowed to perform actions outside the project
 * this key is scoped to"), while this single-project fetch works for every key type.
 * `range` is unused — Neon's own billing-period boundaries (project.consumption_period_*)
 * govern these fields, not an arbitrary caller-supplied range.
 */
export async function fetchNeonConsumption(_range: { from: string; to: string }): Promise<InfraCostFetchResult> {
  const key = process.env.NEON_API_KEY?.trim()
  if (!key) return { ok: false, categories: [], error: "NEON_API_KEY is not set" }
  const result = await resolveNeonProjectDetail()
  if (!result.ok) return { ok: false, categories: [], error: result.error }
  const project = result.project

  const computeHours = (project.compute_time_seconds ?? 0) / CU_SECONDS_PER_HOUR
  const storageGbMonths = (project.data_storage_bytes_hour ?? 0) / BYTES_PER_GB / AVG_HOURS_PER_MONTH
  const transferGb = (project.data_transfer_bytes ?? 0) / BYTES_PER_GB
  const billableTransferGb = Math.max(0, transferGb - NEON_PUBLIC_TRANSFER_FREE_GB)

  const computeCents = Math.round(computeHours * NEON_PRICE.computeUnitHour * 100)
  const storageCents = Math.round(storageGbMonths * NEON_PRICE.storageGbMonth * 100)
  const transferCents = Math.round(billableTransferGb * NEON_PRICE.publicTransferGb * 100)

  return {
    ok: true,
    categories: [
      { provider: "neon" as const, category: "Compute", costCents: computeCents, isEstimate: true },
      { provider: "neon" as const, category: "Storage", costCents: storageCents, isEstimate: true },
      { provider: "neon" as const, category: "Network", costCents: transferCents, isEstimate: true },
    ],
  }
}

// ============================================
// Telnyx — prepaid carrier wallet balance vs a low-balance floor
// ============================================
// Unlike Vercel/Neon's monthly invoices, Telnyx is a prepaid wallet: if it hits $0, live
// calls and SMS actually stop working. So "threshold" here means balance-vs-floor (the
// real operational risk), not spend-vs-budget. TELNYX_API_KEY is already a required env
// var for this app (lib/env.ts) — unlike the optional Vercel/Neon credentials, this
// should always be configured; `ok: false` here means the live API call failed, not a
// missing key.

export type TelnyxBalanceStatus = {
  ok: boolean
  balanceCents: number
  floorCents: number
  error?: string
}

/** Cents, defaults to $20 — change via Vercel → Environment Variables once the real risk floor is known. */
export function resolveTelnyxLowBalanceFloorCents(): number {
  const raw = parseInt(process.env.TELNYX_LOW_BALANCE_FLOOR_CENTS ?? "", 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 2000
}

/** Wraps the existing, already-production-proven getTelnyxAccountBalance() in the same never-throws contract as the Vercel/Neon fetchers. */
export async function fetchTelnyxBalance(): Promise<TelnyxBalanceStatus> {
  const floorCents = resolveTelnyxLowBalanceFloorCents()
  try {
    const balance = await getTelnyxAccountBalance()
    return { ok: true, balanceCents: Math.round(balance.available_credit_usd * 100), floorCents }
  } catch (e) {
    const error = e instanceof Error ? e.message : "Request failed"
    console.warn("[admin-infra-cost] fetchTelnyxBalance failed:", error)
    return { ok: false, balanceCents: 0, floorCents, error }
  }
}
