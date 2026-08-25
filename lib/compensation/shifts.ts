// ============================================
// Work shifts — open, close, sweep, and turn into pay
// ============================================
// The on-duty toggle opens and closes shifts; a sweep closes the ones nobody closed.
// Closing a shift settles its hourly pay the same way a finished call settles its
// talk time, so hours and calls land on the same ledger.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { calculateEarnings, type ShiftPayEvent } from "@/lib/compensation/calculate"
import { recordEarningLines } from "@/lib/compensation/ledger"
import { getPlanInForceAt } from "@/lib/compensation/plans"
import type { WorkerRef } from "@/lib/compensation/plan-schema"

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

function pgErrorCode(e: unknown): string {
  return e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : ""
}

/** True when work_shifts has not been created yet. */
export function isMissingShiftsTable(e: unknown): boolean {
  if (pgErrorCode(e) === "42P01") return true
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes("work_shifts") && msg.includes("does not exist")
}

/**
 * How long a worker's dashboard can go quiet before their shift is closed for them.
 *
 * Long enough to survive a lunch break, a dead zone between jobs, or a laptop asleep
 * on a desk; short enough that a closed browser does not bill the night. The shift is
 * backdated to the last heartbeat, so the gap itself is never paid.
 */
export const SHIFT_HEARTBEAT_GRACE_MINUTES = 30

/** Hard stop for a shift nobody ever closed and that has no heartbeat to fall back on. */
export const SHIFT_MAX_HOURS = 16

export interface WorkShift {
  id: string
  owner_user_id: string
  organization_id: string | null
  worker_role: "receptionist" | "field_tech"
  receptionist_id: string | null
  field_technician_id: string | null
  worker_user_id: string | null
  started_at: string
  ended_at: string | null
  source: "AVAILABILITY" | "MANUAL" | "AUTO_CLOSED"
  approved_at: string | null
  note: string | null
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function parseShiftRow(row: Record<string, unknown>): WorkShift {
  const source = String(row.source ?? "AVAILABILITY")
  return {
    id: String(row.id),
    owner_user_id: String(row.owner_user_id),
    organization_id: row.organization_id ? String(row.organization_id) : null,
    worker_role: String(row.worker_role) === "field_tech" ? "field_tech" : "receptionist",
    receptionist_id: row.receptionist_id ? String(row.receptionist_id) : null,
    field_technician_id: row.field_technician_id ? String(row.field_technician_id) : null,
    worker_user_id: row.worker_user_id ? String(row.worker_user_id) : null,
    started_at: isoOrNull(row.started_at) ?? new Date(0).toISOString(),
    ended_at: isoOrNull(row.ended_at),
    source: ["MANUAL", "AUTO_CLOSED"].includes(source)
      ? (source as WorkShift["source"])
      : "AVAILABILITY",
    approved_at: isoOrNull(row.approved_at),
    note: row.note ? String(row.note) : null,
  }
}

/** Seconds a shift covers, treating an open one as running until `asOf`. */
export function shiftSeconds(shift: WorkShift, asOf = new Date().toISOString()): number {
  const start = Date.parse(shift.started_at)
  const end = Date.parse(shift.ended_at ?? asOf)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return Math.round((end - start) / 1000)
}

/**
 * Put a worker on the clock.
 *
 * Idempotent: someone already on duty stays on their existing shift rather than
 * starting a second one, so a double-tapped toggle cannot pay two overlapping hours.
 */
export async function openShift(params: {
  ownerUserId: string
  organizationId?: string | null
  ref: WorkerRef
  workerUserId?: string | null
  source?: WorkShift["source"]
  startedAt?: string
}): Promise<WorkShift | null> {
  const sql = getSql()
  const receptionistId = params.ref.role === "receptionist" ? params.ref.receptionist_id : null
  const technicianId = params.ref.role === "field_tech" ? params.ref.field_technician_id : null

  try {
    const rows = (await sql`
      INSERT INTO work_shifts (
        owner_user_id, organization_id, worker_role,
        receptionist_id, field_technician_id, worker_user_id,
        started_at, source
      )
      VALUES (
        ${params.ownerUserId},
        ${params.organizationId ?? null},
        ${params.ref.role},
        ${receptionistId},
        ${technicianId},
        ${params.workerUserId ?? null},
        ${params.startedAt ?? new Date().toISOString()}::timestamptz,
        ${params.source ?? "AVAILABILITY"}
      )
      ON CONFLICT DO NOTHING
      RETURNING *
    `) as Record<string, unknown>[]
    if (rows[0]) return parseShiftRow(rows[0])
    return getOpenShift(params.ref)
  } catch (e) {
    if (isMissingShiftsTable(e)) return null
    throw e
  }
}

/** The shift a worker is currently on, if any. */
export async function getOpenShift(ref: WorkerRef): Promise<WorkShift | null> {
  const sql = getSql()
  const receptionistId = ref.role === "receptionist" ? ref.receptionist_id : null
  const technicianId = ref.role === "field_tech" ? ref.field_technician_id : null
  try {
    const rows = (await sql`
      SELECT * FROM work_shifts
      WHERE ended_at IS NULL
        AND (
          (${receptionistId}::uuid IS NOT NULL AND receptionist_id = ${receptionistId}::uuid)
          OR (${technicianId}::uuid IS NOT NULL AND field_technician_id = ${technicianId}::uuid)
        )
      LIMIT 1
    `) as Record<string, unknown>[]
    return rows[0] ? parseShiftRow(rows[0]) : null
  } catch (e) {
    if (isMissingShiftsTable(e)) return null
    throw e
  }
}

/**
 * Take a worker off the clock and pay the hours.
 *
 * Returns null when they were not on one — going off duty twice is not an error, and
 * must not pay twice.
 */
export async function closeShift(params: {
  ref: WorkerRef
  endedAt?: string
  source?: WorkShift["source"]
}): Promise<{ shift: WorkShift; earningsInserted: number } | null> {
  const sql = getSql()
  const receptionistId = params.ref.role === "receptionist" ? params.ref.receptionist_id : null
  const technicianId = params.ref.role === "field_tech" ? params.ref.field_technician_id : null
  const endedAt = params.endedAt ?? new Date().toISOString()

  let shift: WorkShift
  try {
    const rows = (await sql`
      UPDATE work_shifts
      SET ended_at = GREATEST(started_at, ${endedAt}::timestamptz),
          source = COALESCE(${params.source ?? null}, source)
      WHERE ended_at IS NULL
        AND (
          (${receptionistId}::uuid IS NOT NULL AND receptionist_id = ${receptionistId}::uuid)
          OR (${technicianId}::uuid IS NOT NULL AND field_technician_id = ${technicianId}::uuid)
        )
      RETURNING *
    `) as Record<string, unknown>[]
    if (!rows[0]) return null
    shift = parseShiftRow(rows[0])
  } catch (e) {
    if (isMissingShiftsTable(e)) return null
    throw e
  }

  const earningsInserted = await settleShiftEarnings(shift)
  return { shift, earningsInserted }
}

/**
 * Pay a closed shift's hours.
 *
 * Only plans with a shift-based time component earn anything here. A receptionist
 * paid per talk minute is on the clock for the floor's sake, not to be paid twice for
 * the same hour.
 */
export async function settleShiftEarnings(shift: WorkShift): Promise<number> {
  if (!shift.ended_at) return 0
  const seconds = shiftSeconds(shift)
  if (seconds <= 0) return 0

  const ref: WorkerRef =
    shift.worker_role === "receptionist"
      ? { role: "receptionist", receptionist_id: shift.receptionist_id ?? "" }
      : { role: "field_tech", field_technician_id: shift.field_technician_id ?? "" }

  const plan = await getPlanInForceAt(ref, shift.ended_at)
  if (!plan || plan.components.length === 0) return 0

  const event: ShiftPayEvent = {
    kind: "SHIFT",
    id: shift.id,
    occurred_at: shift.ended_at,
    seconds,
  }
  const lines = calculateEarnings(plan.components, event)
  if (lines.length === 0) return 0

  return recordEarningLines({
    ownerUserId: shift.owner_user_id,
    organizationId: shift.organization_id,
    ref,
    workerUserId: shift.worker_user_id,
    planId: plan.id,
    lines,
  })
}

/** Clocked seconds for a worker in a window, counting only the overlap. */
export async function shiftSecondsInWindow(
  ref: WorkerRef,
  startIso: string,
  endIso: string
): Promise<number> {
  const sql = getSql()
  const receptionistId = ref.role === "receptionist" ? ref.receptionist_id : null
  const technicianId = ref.role === "field_tech" ? ref.field_technician_id : null
  try {
    // A shift straddling the window boundary contributes only the part inside it —
    // otherwise an overnight shift would count fully in both workweeks it touches.
    const rows = (await sql`
      SELECT COALESCE(SUM(
        EXTRACT(EPOCH FROM (
          LEAST(COALESCE(ended_at, now()), ${endIso}::timestamptz)
          - GREATEST(started_at, ${startIso}::timestamptz)
        ))
      ), 0)::bigint AS seconds
      FROM work_shifts
      WHERE (
          (${receptionistId}::uuid IS NOT NULL AND receptionist_id = ${receptionistId}::uuid)
          OR (${technicianId}::uuid IS NOT NULL AND field_technician_id = ${technicianId}::uuid)
        )
        AND started_at < ${endIso}::timestamptz
        AND COALESCE(ended_at, now()) > ${startIso}::timestamptz
    `) as Record<string, unknown>[]
    return Math.max(0, Number(rows[0]?.seconds ?? 0))
  } catch (e) {
    if (isMissingShiftsTable(e)) return 0
    throw e
  }
}

/** Shifts overlapping a window, for the owner's timesheet. */
export async function listShiftsForOwner(
  ownerUserId: string,
  startIso: string,
  endIso: string
): Promise<WorkShift[]> {
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT * FROM work_shifts
      WHERE owner_user_id = ${ownerUserId}
        AND started_at < ${endIso}::timestamptz
        AND COALESCE(ended_at, now()) > ${startIso}::timestamptz
      ORDER BY started_at DESC
    `) as Record<string, unknown>[]
    return rows.map(parseShiftRow)
  } catch (e) {
    if (isMissingShiftsTable(e)) return []
    throw e
  }
}

/**
 * Close shifts whose worker stopped checking in, and pay them up to that point.
 *
 * The end time is the worker's last heartbeat, not now: a shift discovered open at
 * 3am ended when the laptop closed at 6pm, and paying the difference would invent
 * nine hours. A worker with no heartbeat at all falls back to a hard cap on shift
 * length, which is a blunt instrument and is why it is logged.
 */
export async function sweepStaleShifts(params?: {
  graceMinutes?: number
  maxHours?: number
  limit?: number
}): Promise<{ closed: number; earningsInserted: number }> {
  const sql = getSql()
  const grace = params?.graceMinutes ?? SHIFT_HEARTBEAT_GRACE_MINUTES
  const maxHours = params?.maxHours ?? SHIFT_MAX_HOURS
  const limit = Math.min(Math.max(1, params?.limit ?? 200), 1000)

  let candidates: { id: string; endAt: string; reason: string }[]
  try {
    const rows = (await sql`
      SELECT
        ws.id,
        ws.started_at,
        h.last_seen_at,
        CASE
          WHEN h.last_seen_at IS NOT NULL AND h.last_seen_at > ws.started_at THEN h.last_seen_at
          ELSE ws.started_at + make_interval(hours => ${maxHours})
        END AS end_at,
        CASE
          WHEN h.last_seen_at IS NOT NULL AND h.last_seen_at > ws.started_at THEN 'heartbeat'
          ELSE 'max_hours'
        END AS reason
      FROM work_shifts ws
      LEFT JOIN operator_dashboard_heartbeats h ON h.user_id = ws.worker_user_id
      WHERE ws.ended_at IS NULL
        AND (
          -- Quiet for longer than the grace period.
          (h.last_seen_at IS NOT NULL AND h.last_seen_at < now() - make_interval(mins => ${grace}))
          -- Or never checked in and has run past the hard cap.
          OR (h.last_seen_at IS NULL AND ws.started_at < now() - make_interval(hours => ${maxHours}))
        )
      ORDER BY ws.started_at ASC
      LIMIT ${limit}
    `) as Record<string, unknown>[]
    candidates = rows.map((row) => ({
      id: String(row.id),
      endAt: isoOrNull(row.end_at) ?? new Date().toISOString(),
      reason: String(row.reason),
    }))
  } catch (e) {
    if (isMissingShiftsTable(e)) return { closed: 0, earningsInserted: 0 }
    throw e
  }

  let closed = 0
  let earningsInserted = 0

  for (const candidate of candidates) {
    const rows = (await sql`
      UPDATE work_shifts
      SET ended_at = GREATEST(started_at, ${candidate.endAt}::timestamptz),
          source = 'AUTO_CLOSED',
          note = COALESCE(note, ${`Closed automatically (${candidate.reason})`})
      WHERE id = ${candidate.id} AND ended_at IS NULL
      RETURNING *
    `) as Record<string, unknown>[]
    if (!rows[0]) continue
    closed += 1
    earningsInserted += await settleShiftEarnings(parseShiftRow(rows[0]))
  }

  if (closed > 0) {
    console.log(JSON.stringify({ zing: "compensation-shifts-swept", closed, earningsInserted }))
  }
  return { closed, earningsInserted }
}
