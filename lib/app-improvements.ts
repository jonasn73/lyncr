/**
 * App Improvement Board — admin-only backlog of app development improvements.
 * Requires scripts/140-app-improvements-board.sql in Neon.
 */

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

export type AppImprovementStatus = "backlog" | "planned" | "in_progress" | "done"
export type AppImprovementPriority = "low" | "medium" | "high"

export type AppImprovement = {
  id: string
  title: string
  description: string | null
  category: string
  status: AppImprovementStatus
  priority: AppImprovementPriority
  source: string | null
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

const STATUSES: AppImprovementStatus[] = ["backlog", "planned", "in_progress", "done"]
const PRIORITIES: AppImprovementPriority[] = ["low", "medium", "high"]

export function isValidAppImprovementStatus(v: string): v is AppImprovementStatus {
  return (STATUSES as string[]).includes(v)
}

export function isValidAppImprovementPriority(v: string): v is AppImprovementPriority {
  return (PRIORITIES as string[]).includes(v)
}

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingTableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes("app_improvements")
}

function parseRow(row: Record<string, unknown>): AppImprovement {
  const statusRaw = String(row.status ?? "backlog")
  const priorityRaw = String(row.priority ?? "medium")
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    description: row.description != null ? String(row.description) : null,
    category: String(row.category ?? "general").trim() || "general",
    status: isValidAppImprovementStatus(statusRaw) ? statusRaw : "backlog",
    priority: isValidAppImprovementPriority(priorityRaw) ? priorityRaw : "medium",
    source: row.source != null ? String(row.source) : null,
    createdByUserId: row.created_by_user_id != null ? String(row.created_by_user_id) : null,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }
}

const SELECT_COLUMNS = `
  id, title, description, category, status, priority, source, created_by_user_id, created_at, updated_at
`

/** All improvements — active statuses first (in_progress, planned, backlog), then done, by priority. */
export async function listAppImprovements(): Promise<AppImprovement[]> {
  const sql = getSql()
  try {
    const rows = await sql.query(`
      SELECT ${SELECT_COLUMNS}
      FROM app_improvements
      ORDER BY
        CASE status
          WHEN 'in_progress' THEN 0
          WHEN 'planned' THEN 1
          WHEN 'backlog' THEN 2
          WHEN 'done' THEN 3
          ELSE 4
        END,
        CASE priority
          WHEN 'high' THEN 0
          WHEN 'medium' THEN 1
          WHEN 'low' THEN 2
          ELSE 3
        END,
        created_at DESC
    `)
    return (rows as Record<string, unknown>[]).map(parseRow)
  } catch (e) {
    if (isMissingTableError(e)) return []
    throw e
  }
}

export async function createAppImprovement(params: {
  title: string
  description?: string | null
  category?: string | null
  priority?: AppImprovementPriority
  status?: AppImprovementStatus
  source?: string | null
  createdByUserId?: string | null
}): Promise<AppImprovement | null> {
  const sql = getSql()
  const title = params.title.trim().slice(0, 200)
  if (!title) return null
  const description = params.description?.trim().slice(0, 4000) || null
  const category = params.category?.trim().slice(0, 40) || "general"
  const status = params.status && isValidAppImprovementStatus(params.status) ? params.status : "backlog"
  const priority =
    params.priority && isValidAppImprovementPriority(params.priority) ? params.priority : "medium"
  const source = params.source?.trim().slice(0, 200) || null
  try {
    const rows = await sql`
      INSERT INTO app_improvements (title, description, category, status, priority, source, created_by_user_id)
      VALUES (${title}, ${description}, ${category}, ${status}, ${priority}, ${source}, ${params.createdByUserId ?? null})
      RETURNING id, title, description, category, status, priority, source, created_by_user_id, created_at, updated_at
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return row ? parseRow(row) : null
  } catch (e) {
    if (isMissingTableError(e)) return null
    throw e
  }
}

/** Full-object update — caller sends the complete edited item (client already holds it from the list). */
export async function updateAppImprovement(
  id: string,
  patch: {
    title: string
    description: string | null
    category: string
    status: AppImprovementStatus
    priority: AppImprovementPriority
  }
): Promise<AppImprovement | null> {
  const sql = getSql()
  const title = patch.title.trim().slice(0, 200)
  if (!title) return null
  try {
    const rows = await sql`
      UPDATE app_improvements
      SET
        title = ${title},
        description = ${patch.description?.trim().slice(0, 4000) || null},
        category = ${patch.category.trim().slice(0, 40) || "general"},
        status = ${patch.status},
        priority = ${patch.priority},
        updated_at = now()
      WHERE id = ${id}
      RETURNING id, title, description, category, status, priority, source, created_by_user_id, created_at, updated_at
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return row ? parseRow(row) : null
  } catch (e) {
    if (isMissingTableError(e)) return null
    throw e
  }
}

/** Quick status-only move (board drag / status dropdown) — smaller payload than a full edit. */
export async function updateAppImprovementStatus(
  id: string,
  status: AppImprovementStatus
): Promise<AppImprovement | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      UPDATE app_improvements
      SET status = ${status}, updated_at = now()
      WHERE id = ${id}
      RETURNING id, title, description, category, status, priority, source, created_by_user_id, created_at, updated_at
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return row ? parseRow(row) : null
  } catch (e) {
    if (isMissingTableError(e)) return null
    throw e
  }
}

export async function deleteAppImprovement(id: string): Promise<boolean> {
  const sql = getSql()
  try {
    const rows = await sql`DELETE FROM app_improvements WHERE id = ${id} RETURNING id`
    return rows.length > 0
  } catch (e) {
    if (isMissingTableError(e)) return false
    throw e
  }
}
