/**
 * Amber leftover-job threads (Neon). Requires scripts/138-amber-coworker.sql.
 */

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { normalizePhoneNumberE164 } from "@/lib/db"
import type { AmberThreadState } from "@/lib/amber-coworker-commands"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingCoworkerRelation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    msg.includes("amber_job_threads") ||
    msg.includes("amber_inbound_seen") ||
    msg.includes("coworker_paused_at")
  )
}

export type AmberJobThreadRow = {
  id: string
  amber_workspace_id: string
  user_id: string
  organization_id: string | null
  lead_id: string
  customer_phone: string
  customer_name: string | null
  job_label: string | null
  address_snippet: string | null
  urgency: string
  state: AmberThreadState
  draft_body: string | null
  draft_expires_at: string | null
  last_instruction: string | null
}

function mapThread(row: Record<string, unknown>): AmberJobThreadRow {
  return {
    id: String(row.id),
    amber_workspace_id: String(row.amber_workspace_id),
    user_id: String(row.user_id),
    organization_id: row.organization_id != null ? String(row.organization_id) : null,
    lead_id: String(row.lead_id),
    customer_phone: String(row.customer_phone),
    customer_name: row.customer_name != null ? String(row.customer_name) : null,
    job_label: row.job_label != null ? String(row.job_label) : null,
    address_snippet: row.address_snippet != null ? String(row.address_snippet) : null,
    urgency: String(row.urgency || "window"),
    state: String(row.state || "awaiting_instruction") as AmberThreadState,
    draft_body: row.draft_body != null ? String(row.draft_body) : null,
    draft_expires_at: row.draft_expires_at != null ? String(row.draft_expires_at) : null,
    last_instruction: row.last_instruction != null ? String(row.last_instruction) : null,
  }
}

/** True when this Telnyx inbound id is new (insert wins). */
export async function claimAmberInboundMessageId(telnyxMessageId: string | null | undefined): Promise<boolean> {
  const id = String(telnyxMessageId || "").trim()
  if (!id) return true
  const sql = sqlClient()
  try {
    const rows = await sql`
      INSERT INTO amber_inbound_seen (telnyx_message_id)
      VALUES (${id})
      ON CONFLICT (telnyx_message_id) DO NOTHING
      RETURNING telnyx_message_id
    `
    return rows.length > 0
  } catch (e) {
    // Table missing: skip handling so a retried SEND cannot ship twice.
    if (isMissingCoworkerRelation(e)) return false
    throw e
  }
}

export async function setAmberCoworkerPaused(params: {
  amberWorkspaceId: string
  paused: boolean
}): Promise<void> {
  const sql = sqlClient()
  try {
    if (params.paused) {
      await sql`
        UPDATE amber_workspaces
        SET coworker_paused_at = now(), updated_at = now()
        WHERE id = ${params.amberWorkspaceId}::uuid
      `
    } else {
      await sql`
        UPDATE amber_workspaces
        SET coworker_paused_at = NULL, updated_at = now()
        WHERE id = ${params.amberWorkspaceId}::uuid
      `
    }
  } catch (e) {
    if (isMissingCoworkerRelation(e)) return
    throw e
  }
}

export async function getOpenAmberJobThread(params: {
  userId: string
  amberWorkspaceId: string
}): Promise<AmberJobThreadRow | null> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT
        id::text,
        amber_workspace_id::text,
        user_id::text,
        organization_id::text,
        lead_id::text,
        customer_phone,
        customer_name,
        job_label,
        address_snippet,
        urgency,
        state,
        draft_body,
        draft_expires_at::text,
        last_instruction
      FROM amber_job_threads
      WHERE user_id = ${params.userId}::uuid
        AND amber_workspace_id = ${params.amberWorkspaceId}::uuid
        AND state IN ('awaiting_instruction', 'awaiting_send')
      ORDER BY created_at DESC
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return row ? mapThread(row) : null
  } catch (e) {
    if (isMissingCoworkerRelation(e)) return null
    throw e
  }
}

export async function updateAmberJobThread(params: {
  threadId: string
  state: AmberThreadState
  draftBody?: string | null
  draftExpiresAt?: Date | null
  lastInstruction?: string | null
}): Promise<void> {
  const sql = sqlClient()
  const resolved =
    params.state === "sent" || params.state === "skipped" || params.state === "expired"
      ? new Date().toISOString()
      : null
  const draftBody = params.draftBody === undefined ? "" : params.draftBody
  const keepDraft = params.draftBody === undefined
  const expiresIso = params.draftExpiresAt ? params.draftExpiresAt.toISOString() : null
  const keepExpires = params.draftExpiresAt === undefined
  const instruction = params.lastInstruction === undefined ? "" : params.lastInstruction
  const keepInstruction = params.lastInstruction === undefined
  try {
    await sql`
      UPDATE amber_job_threads
      SET
        state = ${params.state},
        draft_body = CASE WHEN ${keepDraft} THEN draft_body ELSE ${draftBody} END,
        draft_expires_at = CASE
          WHEN ${keepExpires} THEN draft_expires_at
          ELSE ${expiresIso}::timestamptz
        END,
        last_instruction = CASE WHEN ${keepInstruction} THEN last_instruction ELSE ${instruction} END,
        resolved_at = COALESCE(${resolved}::timestamptz, resolved_at),
        updated_at = now()
      WHERE id = ${params.threadId}::uuid
    `
  } catch (e) {
    if (isMissingCoworkerRelation(e)) return
    throw e
  }
}

/** Count leftover pings already sent today (cap). */
export async function countAmberPingsSince(params: {
  userId: string
  sinceIso: string
}): Promise<number> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT count(*)::int AS n
      FROM amber_job_threads
      WHERE user_id = ${params.userId}::uuid
        AND pinged_at IS NOT NULL
        AND pinged_at >= ${params.sinceIso}::timestamptz
    `
    return Number((rows[0] as { n?: number } | undefined)?.n ?? 0)
  } catch (e) {
    if (isMissingCoworkerRelation(e)) return 0
    throw e
  }
}

export type LeftoverBookCandidate = {
  lead_id: string
  user_id: string
  organization_id: string | null
  amber_workspace_id: string
  amber_number: string
  owner_mobile_e164: string
  timezone: string
  caller_e164: string
  customer_name: string | null
  job_label: string
  address_snippet: string | null
  urgency: string
  created_at: string
}

/**
 * Book-form leads still status lead, older than 20 minutes, no Amber thread yet.
 * Caller still filters quiet hours, daily cap, and one-open-thread.
 */
export async function listLeftoverBookFormCandidates(limit = 15): Promise<LeftoverBookCandidate[]> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT
        l.id::text AS lead_id,
        l.user_id::text,
        w.organization_id::text,
        w.id::text AS amber_workspace_id,
        p.number AS amber_number,
        w.owner_mobile_e164,
        w.timezone,
        coalesce(nullif(trim(l.caller_e164), ''), nullif(trim(l.collected->>'customer_phone'), '')) AS caller_e164,
        coalesce(
          nullif(trim(l.collected->>'customer_name'), ''),
          nullif(trim(l.collected->>'name'), ''),
          nullif(trim(l.summary), '')
        ) AS customer_name,
        coalesce(
          nullif(trim(l.collected->>'job_type'), ''),
          nullif(trim(l.intent_slug), ''),
          'request'
        ) AS job_label,
        coalesce(
          nullif(trim(l.job_address_route), ''),
          nullif(trim(l.collected->>'address_line1'), ''),
          nullif(trim(l.collected->>'address'), '')
        ) AS street,
        coalesce(
          nullif(trim(l.job_address_locality), ''),
          nullif(trim(l.collected->>'city'), '')
        ) AS city,
        coalesce(nullif(trim(l.job_address_full), ''), '') AS address_full,
        CASE
          WHEN coalesce(l.collected->>'source', '') = 'public_book_asap'
            OR lower(coalesce(l.collected->>'urgency', '')) = 'asap'
          THEN 'asap'
          ELSE 'window'
        END AS urgency,
        l.created_at::text
      FROM ai_leads l
      JOIN amber_workspaces w
        ON w.user_id = l.user_id
       AND w.enabled = true
       AND w.owner_mobile_verified_at IS NOT NULL
       AND w.coworker_paused_at IS NULL
       AND (
         w.organization_id IS NOT DISTINCT FROM l.organization_id
         OR (
           l.organization_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM amber_workspaces other
             WHERE other.user_id = w.user_id
               AND other.enabled = true
               AND other.id <> w.id
           )
         )
       )
      JOIN phone_numbers p ON p.id = w.phone_number_id AND p.is_amber_control = true
      WHERE l.created_at < now() - interval '20 minutes'
        AND l.created_at > now() - interval '48 hours'
        AND lower(trim(coalesce(nullif(trim(l.job_status), ''), nullif(trim(l.collected->>'job_status'), ''), 'lead'))) = 'lead'
        AND coalesce(l.collected->>'source', '') IN (
          'public_book_asap', 'public_book_window', 'public_book', 'activity_book_link'
        )
        AND coalesce(l.collected->>'callback_outcome', '') = ''
        AND l.scheduled_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM amber_job_threads t WHERE t.lead_id = l.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM amber_job_threads open_t
          WHERE open_t.amber_workspace_id = w.id
            AND open_t.state IN ('awaiting_instruction', 'awaiting_send')
        )
      ORDER BY l.created_at ASC
      LIMIT ${limit}
    `
    const out: LeftoverBookCandidate[] = []
    for (const raw of rows as Record<string, unknown>[]) {
      const phone = normalizePhoneNumberE164(String(raw.caller_e164 || ""))
      const owner = normalizePhoneNumberE164(String(raw.owner_mobile_e164 || ""))
      const amberNumber = normalizePhoneNumberE164(String(raw.amber_number || ""))
      if (!phone || !owner || !amberNumber) continue
      const street = raw.street != null ? String(raw.street) : ""
      const city = raw.city != null ? String(raw.city) : ""
      const full = raw.address_full != null ? String(raw.address_full) : ""
      const snippet = [street, city].filter(Boolean).join(", ") || full || null
      out.push({
        lead_id: String(raw.lead_id),
        user_id: String(raw.user_id),
        organization_id: raw.organization_id != null ? String(raw.organization_id) : null,
        amber_workspace_id: String(raw.amber_workspace_id),
        amber_number: amberNumber,
        owner_mobile_e164: owner,
        timezone: String(raw.timezone || "America/New_York"),
        caller_e164: phone,
        customer_name: raw.customer_name != null ? String(raw.customer_name) : null,
        job_label: String(raw.job_label || "request"),
        address_snippet: snippet ? snippet.slice(0, 80) : null,
        urgency: String(raw.urgency || "window"),
        created_at: String(raw.created_at),
      })
    }
    return out
  } catch (e) {
    if (isMissingCoworkerRelation(e)) return []
    console.warn("[amber-coworker] leftover query failed:", e)
    return []
  }
}

/** True when the shop already texted this customer after the lead was created. */
export async function customerAlreadyGotOutboundSms(params: {
  userId: string
  customerPhone: string
  sinceIso: string
}): Promise<boolean> {
  const sql = sqlClient()
  const last10 = params.customerPhone.replace(/\D/g, "").slice(-10)
  if (last10.length < 10) return false
  try {
    const rows = await sql`
      SELECT 1
      FROM sms_messages
      WHERE owner_user_id = ${params.userId}::uuid
        AND direction = 'outbound'
        AND created_at >= ${params.sinceIso}::timestamptz
        AND right(regexp_replace(coalesce(customer_phone, to_number, ''), '\\D', '', 'g'), 10) = ${last10}
      LIMIT 1
    `
    return rows.length > 0
  } catch {
    return false
  }
}

/** True when lost-lead recovery already auto-texted this phone. */
export async function lostLeadRecoveryAlreadySent(params: {
  userId: string
  customerPhone: string
}): Promise<boolean> {
  const sql = sqlClient()
  const last10 = params.customerPhone.replace(/\D/g, "").slice(-10)
  if (last10.length < 10) return false
  try {
    const rows = await sql`
      SELECT 1
      FROM lost_leads
      WHERE user_id = ${params.userId}::uuid
        AND recovery_sms_sent_at IS NOT NULL
        AND right(regexp_replace(phone_number, '\\D', '', 'g'), 10) = ${last10}
        AND recovery_sms_sent_at > now() - interval '7 days'
      LIMIT 1
    `
    return rows.length > 0
  } catch {
    return false
  }
}

/** Insert thread if this lead is still free. Returns the row when we won the claim. */
export async function claimAmberLeftoverThread(params: {
  amberWorkspaceId: string
  userId: string
  organizationId: string | null
  leadId: string
  customerPhone: string
  customerName: string | null
  jobLabel: string
  addressSnippet: string | null
  urgency: string
}): Promise<AmberJobThreadRow | null> {
  const sql = sqlClient()
  const orgId = params.organizationId?.trim() || null
  try {
    const rows = orgId
      ? await sql`
      INSERT INTO amber_job_threads (
        amber_workspace_id, user_id, organization_id, lead_id,
        customer_phone, customer_name, job_label, address_snippet, urgency,
        state, pinged_at
      )
      VALUES (
        ${params.amberWorkspaceId}::uuid,
        ${params.userId}::uuid,
        ${orgId}::uuid,
        ${params.leadId}::uuid,
        ${params.customerPhone},
        ${params.customerName},
        ${params.jobLabel},
        ${params.addressSnippet},
        ${params.urgency},
        'awaiting_instruction',
        now()
      )
      ON CONFLICT (lead_id) DO NOTHING
      RETURNING
        id::text,
        amber_workspace_id::text,
        user_id::text,
        organization_id::text,
        lead_id::text,
        customer_phone,
        customer_name,
        job_label,
        address_snippet,
        urgency,
        state,
        draft_body,
        draft_expires_at::text,
        last_instruction
    `
      : await sql`
      INSERT INTO amber_job_threads (
        amber_workspace_id, user_id, organization_id, lead_id,
        customer_phone, customer_name, job_label, address_snippet, urgency,
        state, pinged_at
      )
      VALUES (
        ${params.amberWorkspaceId}::uuid,
        ${params.userId}::uuid,
        NULL,
        ${params.leadId}::uuid,
        ${params.customerPhone},
        ${params.customerName},
        ${params.jobLabel},
        ${params.addressSnippet},
        ${params.urgency},
        'awaiting_instruction',
        now()
      )
      ON CONFLICT (lead_id) DO NOTHING
      RETURNING
        id::text,
        amber_workspace_id::text,
        user_id::text,
        organization_id::text,
        lead_id::text,
        customer_phone,
        customer_name,
        job_label,
        address_snippet,
        urgency,
        state,
        draft_body,
        draft_expires_at::text,
        last_instruction
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return row ? mapThread(row) : null
  } catch (e) {
    if (isMissingCoworkerRelation(e)) return null
    const msg = e instanceof Error ? e.message : String(e)
    // Unique one-open-thread index: another leftover already claimed this shop.
    if (msg.includes("amber_job_threads_one_open_per_workspace") || /unique/i.test(msg)) {
      return null
    }
    throw e
  }
}

export async function expireStaleAmberDrafts(): Promise<AmberJobThreadRow[]> {
  const sql = sqlClient()
  try {
    // Draft timed out — keep the leftover open so 15-min cover can still fire.
    const rows = await sql`
      UPDATE amber_job_threads
      SET state = 'awaiting_instruction', updated_at = now()
      WHERE state = 'awaiting_send'
        AND draft_expires_at IS NOT NULL
        AND draft_expires_at < now()
      RETURNING
        id::text,
        amber_workspace_id::text,
        user_id::text,
        organization_id::text,
        lead_id::text,
        customer_phone,
        customer_name,
        job_label,
        address_snippet,
        urgency,
        state,
        draft_body,
        draft_expires_at::text,
        last_instruction
    `
    return (rows as Record<string, unknown>[]).map(mapThread)
  } catch (e) {
    if (isMissingCoworkerRelation(e)) return []
    throw e
  }
}

export type SilentAmberThreadRow = AmberJobThreadRow & {
  pinged_at: string
  amber_number: string
  owner_mobile_e164: string
}

/** Open leftover threads whose owner ping is older than 15 minutes (matches AMBER_SILENT_LEFTOVER_MINUTES). */
export async function listSilentOpenAmberThreads(): Promise<SilentAmberThreadRow[]> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT
        t.id::text,
        t.amber_workspace_id::text,
        t.user_id::text,
        t.organization_id::text,
        t.lead_id::text,
        t.customer_phone,
        t.customer_name,
        t.job_label,
        t.address_snippet,
        t.urgency,
        t.state,
        t.draft_body,
        t.draft_expires_at::text,
        t.last_instruction,
        t.pinged_at::text,
        p.number AS amber_number,
        w.owner_mobile_e164
      FROM amber_job_threads t
      JOIN amber_workspaces w ON w.id = t.amber_workspace_id
      JOIN phone_numbers p ON p.id = w.phone_number_id AND p.is_amber_control = true
      WHERE t.state = 'awaiting_instruction'
        AND t.pinged_at IS NOT NULL
        AND t.pinged_at <= now() - interval '15 minutes'
        AND w.enabled = true
        AND w.coworker_paused_at IS NULL
        AND w.owner_mobile_verified_at IS NOT NULL
      ORDER BY t.pinged_at ASC
      LIMIT 20
    `
    const out: SilentAmberThreadRow[] = []
    for (const raw of rows as Record<string, unknown>[]) {
      const amberNumber = normalizePhoneNumberE164(String(raw.amber_number || ""))
      const owner = normalizePhoneNumberE164(String(raw.owner_mobile_e164 || ""))
      const pinged = raw.pinged_at != null ? String(raw.pinged_at) : ""
      if (!amberNumber || !owner || !pinged) continue
      out.push({
        ...mapThread(raw),
        pinged_at: pinged,
        amber_number: amberNumber,
        owner_mobile_e164: owner,
      })
    }
    return out
  } catch (e) {
    if (isMissingCoworkerRelation(e)) return []
    throw e
  }
}

export async function markAmberThreadPingFailed(threadId: string): Promise<void> {
  await updateAmberJobThread({ threadId, state: "ping_failed" })
}
