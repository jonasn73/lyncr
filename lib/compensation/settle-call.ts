// ============================================
// Call settlement — turn a finished call leg into ledger rows
// ============================================
// Called when a call reaches a terminal state, and again by the backfill sweep for
// anything the webhook missed. Both are safe to run repeatedly: the ledger's dedupe
// index means a call that has already been paid inserts nothing.
//
// Settlement is deliberately tolerant of incomplete timing. Talk seconds come from
// answered_at → ended_at and nothing else, so a leg whose ended_at has not landed yet
// computes zero, writes no row, and gets picked up by the sweep once it has. That is
// better than guessing from duration_seconds, which is the whole call including the
// ring and the caller's time in the hold menu.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  calculateEarnings,
  type CallPayEvent,
  type EarningLine,
} from "@/lib/compensation/calculate"
import { recordEarningLines } from "@/lib/compensation/ledger"
import { getPlanInForceAt } from "@/lib/compensation/plans"
import { legacyReceptionistComponents, type PayComponent } from "@/lib/compensation/plan-schema"
import {
  isAnsweredReceptionistCall,
  resolveReceptionistLegDurationSeconds,
} from "@/lib/receptionist-pay"

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

/** A call leg with everything settlement needs, and its receptionist's pay fallback. */
interface SettlementRow {
  call_id: string
  owner_user_id: string
  organization_id: string | null
  receptionist_id: string
  portal_user_id: string | null
  status: string
  answered_at: string | null
  ended_at: string | null
  pay_mode: string | null
  rate_per_minute: number | null
  flat_rate_usd: number | null
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function parseSettlementRow(row: Record<string, unknown>): SettlementRow {
  return {
    call_id: String(row.call_id),
    owner_user_id: String(row.owner_user_id),
    organization_id: row.organization_id ? String(row.organization_id) : null,
    receptionist_id: String(row.receptionist_id),
    portal_user_id: row.portal_user_id ? String(row.portal_user_id) : null,
    status: String(row.status ?? ""),
    answered_at: isoOrNull(row.answered_at),
    ended_at: isoOrNull(row.ended_at),
    pay_mode: row.pay_mode ? String(row.pay_mode) : null,
    rate_per_minute: row.rate_per_minute == null ? null : Number(row.rate_per_minute),
    flat_rate_usd: row.flat_rate_usd == null ? null : Number(row.flat_rate_usd),
  }
}

/**
 * The call plus its receptionist, by call_logs.id.
 *
 * organization_id comes from the line the call arrived on — the same join the call
 * telemetry snapshot uses — because call_logs has no workspace of its own.
 */
async function loadSettlementRowById(callLogId: string): Promise<SettlementRow | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT
      cl.id AS call_id, cl.user_id AS owner_user_id, cl.status,
      cl.answered_at, cl.ended_at,
      r.id AS receptionist_id, r.portal_user_id,
      r.pay_mode, r.rate_per_minute, r.flat_rate_usd,
      pn.organization_id
    FROM call_logs cl
    JOIN receptionists r ON r.id = cl.routed_to_receptionist_id
    LEFT JOIN phone_numbers pn ON pn.user_id = cl.user_id
      AND regexp_replace(coalesce(pn.number, ''), '\\D', '', 'g')
        = regexp_replace(coalesce(cl.to_number, ''), '\\D', '', 'g')
    WHERE cl.id = ${callLogId}
    LIMIT 1
  `) as Record<string, unknown>[]
  return rows[0] ? parseSettlementRow(rows[0]) : null
}

/** Same row, found by the carrier's call id — what the webhooks have in hand. */
async function loadSettlementRowBySid(providerCallSid: string): Promise<SettlementRow | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT
      cl.id AS call_id, cl.user_id AS owner_user_id, cl.status,
      cl.answered_at, cl.ended_at,
      r.id AS receptionist_id, r.portal_user_id,
      r.pay_mode, r.rate_per_minute, r.flat_rate_usd,
      pn.organization_id
    FROM call_logs cl
    JOIN receptionists r ON r.id = cl.routed_to_receptionist_id
    LEFT JOIN phone_numbers pn ON pn.user_id = cl.user_id
      AND regexp_replace(coalesce(pn.number, ''), '\\D', '', 'g')
        = regexp_replace(coalesce(cl.to_number, ''), '\\D', '', 'g')
    WHERE cl.provider_call_sid = ${providerCallSid.trim()}
    LIMIT 1
  `) as Record<string, unknown>[]
  return rows[0] ? parseSettlementRow(rows[0]) : null
}

export type CallSettlementReason =
  | "no_receptionist"
  | "not_answered"
  | "no_talk_time"
  | "earned_nothing"

export interface CallSettlementResult {
  /** Whether a payable leg was found at all. */
  settled: boolean
  /** Rows actually written — 0 when the call was already on the ledger. */
  inserted: number
  reason?: CallSettlementReason
}

/** A call leg reduced to what settlement actually decides on. */
export interface CallSettlementInput {
  callId: string
  status: string
  answered_at: string | null
  ended_at: string | null
  components: PayComponent[]
}

export interface CallSettlementDecision {
  lines: EarningLine[]
  /** When the earnings are dated — the end of the call. */
  earnedAt: string | null
  /** Set when nothing is payable, so the caller knows whether to retry later. */
  reason?: CallSettlementReason
  /** True when this call should be looked at again once more timing arrives. */
  retryable: boolean
}

/**
 * What a finished call leg earns — the whole decision, with no database in it.
 *
 * Three ways to earn nothing, and they are not the same:
 *
 *   not_answered   the leg was never picked up. Final; there is nothing to wait for.
 *   no_talk_time   answered_at or ended_at has not landed yet. Retryable — writing a
 *                  zero row here would claim the call was settled at nothing, and the
 *                  dedupe index would then block the real amount.
 *   earned_nothing the plan genuinely pays zero, e.g. a 3-second pickup under a flat
 *                  fee with a 20-second floor. Final.
 */
export function resolveCallSettlement(input: CallSettlementInput): CallSettlementDecision {
  const answered = isAnsweredReceptionistCall({
    status: input.status,
    answered_at: input.answered_at,
  })
  if (!answered) {
    return { lines: [], earnedAt: null, reason: "not_answered", retryable: false }
  }

  const talkSeconds = resolveReceptionistLegDurationSeconds({
    answered_at: input.answered_at,
    ended_at: input.ended_at,
    duration_seconds: 0,
  })
  if (talkSeconds <= 0) {
    return { lines: [], earnedAt: null, reason: "no_talk_time", retryable: true }
  }

  const earnedAt = input.ended_at ?? input.answered_at ?? new Date().toISOString()
  const event: CallPayEvent = {
    kind: "CALL",
    id: input.callId,
    occurred_at: earnedAt,
    answered: true,
    talk_seconds: talkSeconds,
  }

  const lines = calculateEarnings(input.components, event)
  if (lines.length === 0) {
    return { lines: [], earnedAt, reason: "earned_nothing", retryable: false }
  }
  return { lines, earnedAt, retryable: false }
}

async function settleRow(row: SettlementRow): Promise<CallSettlementResult> {
  // Date the earnings at the end of the call so the right plan version is picked —
  // a rate change last week must not reprice a call from the week before.
  const earnedAt = row.ended_at ?? row.answered_at ?? new Date().toISOString()
  const ref = { role: "receptionist" as const, receptionist_id: row.receptionist_id }

  const plan = await getPlanInForceAt(ref, earnedAt)
  const components: PayComponent[] =
    plan && plan.components.length > 0 ? plan.components : legacyReceptionistComponents(row)

  const decision = resolveCallSettlement({
    callId: row.call_id,
    status: row.status,
    answered_at: row.answered_at,
    ended_at: row.ended_at,
    components,
  })

  if (decision.lines.length === 0) {
    return { settled: !decision.retryable, inserted: 0, reason: decision.reason }
  }
  const lines = decision.lines

  const inserted = await recordEarningLines({
    ownerUserId: row.owner_user_id,
    organizationId: row.organization_id,
    ref,
    workerUserId: row.portal_user_id,
    planId: plan?.id ?? null,
    lines,
  })

  return { settled: true, inserted }
}

/** Settle one call by call_logs.id. */
export async function settleCallEarningsById(callLogId: string): Promise<CallSettlementResult> {
  const row = await loadSettlementRowById(callLogId)
  if (!row) return { settled: false, inserted: 0, reason: "no_receptionist" }
  return settleRow(row)
}

/** Settle one call by the carrier's call id. */
export async function settleCallEarningsBySid(
  providerCallSid: string
): Promise<CallSettlementResult> {
  const row = await loadSettlementRowBySid(providerCallSid)
  if (!row) return { settled: false, inserted: 0, reason: "no_receptionist" }
  return settleRow(row)
}

/**
 * Fire-and-forget settlement for webhook handlers.
 *
 * Never throws and never blocks the response. A call that fails to settle here is
 * not lost — it has no ledger row, so the next sweep picks it up.
 */
export function settleCallEarningsInBackground(providerCallSid: string): void {
  void settleCallEarningsBySid(providerCallSid)
    .then((result) => {
      if (result.inserted > 0) {
        console.log(
          JSON.stringify({
            zing: "compensation-call-settled",
            providerCallSid,
            rows: result.inserted,
          })
        )
      }
    })
    .catch((e) => {
      console.error("[compensation] call settlement failed:", e)
    })
}

/**
 * Settle every answered leg in a window that has no ledger row yet.
 *
 * This is both the historical backfill and the safety net for calls whose webhook
 * settlement was missed or ran before ended_at landed. Idempotent by construction.
 */
export async function sweepUnsettledCalls(params: {
  ownerUserId?: string | null
  startIso: string
  endIso: string
  limit?: number
}): Promise<{ scanned: number; settled: number; inserted: number }> {
  const sql = getSql()
  const limit = Math.min(Math.max(1, params.limit ?? 500), 5000)

  const rows = (await sql`
    SELECT cl.id
    FROM call_logs cl
    JOIN receptionists r ON r.id = cl.routed_to_receptionist_id
    WHERE cl.answered_at IS NOT NULL
      AND cl.ended_at IS NOT NULL
      AND lower(cl.status) IN ('answered', 'completed', 'in-progress')
      AND cl.ended_at >= ${params.startIso}::timestamptz
      AND cl.ended_at < ${params.endIso}::timestamptz
      AND (${params.ownerUserId ?? null}::uuid IS NULL OR cl.user_id = ${params.ownerUserId ?? null}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM earnings_ledger el
        WHERE el.receptionist_id = r.id
          AND el.source_kind = 'CALL'
          AND el.source_id = cl.id
      )
    ORDER BY cl.ended_at ASC
    LIMIT ${limit}
  `) as Record<string, unknown>[]

  let settled = 0
  let inserted = 0
  for (const row of rows) {
    const result = await settleCallEarningsById(String(row.id))
    if (result.settled) settled += 1
    inserted += result.inserted
  }

  return { scanned: rows.length, settled, inserted }
}
