// Insert a placeholder call_logs row for manual / walk-in dispatch intake.

import {
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { neon } from "@neondatabase/serverless"

export type InsertManualIntakeCallLogInput = {
  ownerUserId: string
  phoneNumber: string
  toNumber?: string | null
  callerName?: string | null
  /** Field-tech portal users.id (optional). */
  technicianUserId?: string | null
  metadata?: Record<string, unknown>
}

export type InsertManualIntakeCallLogResult = {
  call_log_id: string
  provider_call_sid: string
  call_type: "manual_intake" | "incoming"
  intake_source: "walk_in"
}

let cachedSql: ReturnType<typeof neon> | null = null

function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

function pgErrorCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e) return String((e as { code: unknown }).code)
  return undefined
}

function pgErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Persist a walk-in manual intake stub so Activity + metrics share one call_logs id. */
export async function insertManualIntakeCallLog(
  input: InsertManualIntakeCallLogInput
): Promise<InsertManualIntakeCallLogResult> {
  const fromNumber = normalizePhoneNumberE164(input.phoneNumber)
  if (!isReasonablePstnDialString(fromNumber)) {
    throw new Error("Enter a valid caller phone number.")
  }

  const toNumber = input.toNumber?.trim() || "Manual intake"
  const callerName = input.callerName?.trim() || null
  const techUserId = input.technicianUserId?.trim() || null
  const metadata = input.metadata ?? {}
  const providerCallSid = `manual-intake-${crypto.randomUUID()}`
  const metadataJson = JSON.stringify({
    ...metadata,
    source: "walk_in",
    direction: "manual_intake",
  })

  const sql = getSql()

  try {
    const rows = await sql`
      INSERT INTO call_logs (
        user_id, provider_call_sid, from_number, to_number, caller_name,
        call_type, status, duration_seconds, routed_to_receptionist_id,
        routed_to_name, has_recording, recording_url, recording_duration_seconds,
        first_ring_at, answered_at, intake_source, intake_metadata, assigned_tech_user_id
      ) VALUES (
        ${input.ownerUserId}, ${providerCallSid}, ${fromNumber}, ${toNumber}, ${callerName},
        'manual_intake', 'answered', 0, NULL,
        NULL, false, NULL, NULL,
        now(), now(), 'walk_in', ${metadataJson}::jsonb,
        ${techUserId}
      )
      RETURNING id
    `
    const callLogId = String(rows[0]?.id ?? "")
    if (!callLogId) throw new Error("Manual call log insert returned no id.")
    return {
      call_log_id: callLogId,
      provider_call_sid: providerCallSid,
      call_type: "manual_intake",
      intake_source: "walk_in",
    }
  } catch (e) {
    const code = pgErrorCode(e)
    const msg = pgErrorMessage(e)

    // Pre-migration fallback: store as incoming + status flag + sid prefix.
    if (
      code === "23514" ||
      msg.includes("call_logs_call_type_check") ||
      msg.includes("manual_intake") ||
      (code === "42703" && (msg.includes("intake_source") || msg.includes("intake_metadata")))
    ) {
      const rows = await sql`
        INSERT INTO call_logs (
          user_id, provider_call_sid, from_number, to_number, caller_name,
          call_type, status, duration_seconds, routed_to_receptionist_id,
          routed_to_name, has_recording, recording_url, recording_duration_seconds,
          first_ring_at, answered_at
        ) VALUES (
          ${input.ownerUserId}, ${providerCallSid}, ${fromNumber}, ${toNumber}, ${callerName},
          'incoming', 'manual_intake', 0, NULL,
          NULL, false, NULL, NULL,
          now(), now()
        )
        RETURNING id
      `
      const callLogId = String(rows[0]?.id ?? "")
      if (!callLogId) throw new Error("Manual call log fallback insert returned no id.")
      return {
        call_log_id: callLogId,
        provider_call_sid: providerCallSid,
        call_type: "incoming",
        intake_source: "walk_in",
      }
    }

    throw e
  }
}
