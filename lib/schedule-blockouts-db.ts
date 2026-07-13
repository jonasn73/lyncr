// Neon CRUD for schedule_blockouts (owner calendar unavailability).

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import type { ScheduleBlockout } from "@/lib/types"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingTableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes("schedule_blockouts") && (msg.includes("does not exist") || msg.includes("undefined_table"))
}

function rowToBlockout(row: Record<string, unknown>): ScheduleBlockout {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    organization_id: row.organization_id != null ? String(row.organization_id) : null,
    date: String(row.date),
    is_full_day: row.is_full_day === true,
    start_time: row.start_time != null ? String(row.start_time) : null,
    end_time: row.end_time != null ? String(row.end_time) : null,
    reason: row.reason != null ? String(row.reason) : null,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at ?? ""),
    updated_at: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : String(row.updated_at ?? ""),
  }
}

/** List blockouts for an owner in an inclusive date range (YYYY-MM-DD). */
export async function listScheduleBlockouts(params: {
  ownerUserId: string
  fromDate: string
  toDate: string
  organizationId?: string | null
}): Promise<ScheduleBlockout[]> {
  const sql = sqlClient()
  try {
    const orgId =
      params.organizationId && !params.organizationId.startsWith("legacy-")
        ? params.organizationId
        : null

    if (orgId) {
      const rows = await sql`
        SELECT *
        FROM schedule_blockouts
        WHERE user_id = ${params.ownerUserId}
          AND date >= ${params.fromDate}
          AND date <= ${params.toDate}
          AND (organization_id = ${orgId} OR organization_id IS NULL)
        ORDER BY date ASC, start_time ASC NULLS FIRST
      `
      return (rows as Record<string, unknown>[]).map(rowToBlockout)
    }

    const rows = await sql`
      SELECT *
      FROM schedule_blockouts
      WHERE user_id = ${params.ownerUserId}
        AND date >= ${params.fromDate}
        AND date <= ${params.toDate}
      ORDER BY date ASC, start_time ASC NULLS FIRST
    `
    return (rows as Record<string, unknown>[]).map(rowToBlockout)
  } catch (e) {
    if (isMissingTableError(e)) {
      console.warn("[schedule-blockouts-db] table missing — run scripts/088-schedule-blockouts.sql")
      return []
    }
    throw e
  }
}

/** Insert a new blockout row. */
export async function createScheduleBlockout(params: {
  ownerUserId: string
  organizationId?: string | null
  date: string
  isFullDay: boolean
  startTime?: string | null
  endTime?: string | null
  reason?: string | null
}): Promise<ScheduleBlockout> {
  const sql = sqlClient()
  const orgId =
    params.organizationId && !params.organizationId.startsWith("legacy-")
      ? params.organizationId
      : null
  const reason = (params.reason || "").trim() || null
  const isFullDay = params.isFullDay === true
  const startTime = isFullDay ? null : (params.startTime || "").trim() || null
  const endTime = isFullDay ? null : (params.endTime || "").trim() || null

  try {
    const rows = await sql`
      INSERT INTO schedule_blockouts (
        user_id, organization_id, date, is_full_day, start_time, end_time, reason
      ) VALUES (
        ${params.ownerUserId},
        ${orgId},
        ${params.date.trim()},
        ${isFullDay},
        ${startTime},
        ${endTime},
        ${reason}
      )
      RETURNING *
    `
    const row = (rows as Record<string, unknown>[])[0]
    if (!row) throw new Error("Insert returned no row")
    return rowToBlockout(row)
  } catch (e) {
    if (isMissingTableError(e)) {
      const err = new Error(
        "schedule_blockouts table missing — run scripts/088-schedule-blockouts.sql in Neon."
      )
      ;(err as Error & { code?: string }).code = "BLOCKOUT_MIGRATION_REQUIRED"
      throw err
    }
    throw e
  }
}

/** Delete a blockout owned by this user (reopens the slots). */
export async function deleteScheduleBlockout(params: {
  ownerUserId: string
  blockoutId: string
}): Promise<boolean> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      DELETE FROM schedule_blockouts
      WHERE id = ${params.blockoutId} AND user_id = ${params.ownerUserId}
      RETURNING id
    `
    return (rows as unknown[]).length > 0
  } catch (e) {
    if (isMissingTableError(e)) return false
    throw e
  }
}
