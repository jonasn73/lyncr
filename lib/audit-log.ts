// Platform-wide audit trail — one write path for every signup-through-action event,
// so /admin/audit can trace exactly what happened for a business when something gets
// stuck. See scripts/165-audit-events.sql for the table.

import { insertAuditEvent } from "@/lib/db"
import type { ActorRole } from "@/lib/actor"

export type AuditEventRecordInput = {
  /** Whose account this event is about. Null only for pre-account events (e.g. a failed signup). */
  ownerUserId: string | null
  /** Who actually did it — may differ from ownerUserId (a receptionist/tech/admin acting on it). */
  actorUserId: string | null
  actorRole: ActorRole | "anonymous" | "system"
  /** Dot-namespaced, e.g. "auth.signup", "admin.impersonate_start". */
  eventType: string
  entityType?: string
  entityId?: string
  detail?: Record<string, unknown>
}

/**
 * Fire-and-forget audit write. Never throws and never blocks the caller on the DB —
 * callers just do `void recordAuditEvent({...})` right after the real operation
 * they're annotating already succeeded.
 */
export async function recordAuditEvent(params: AuditEventRecordInput): Promise<void> {
  try {
    await insertAuditEvent({
      ownerUserId: params.ownerUserId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      eventType: params.eventType,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      detail: params.detail ?? {},
    })
  } catch (e) {
    // insertAuditEvent already swallows its own errors — this is a last-resort net.
    console.error("[audit-log] recordAuditEvent failed:", e)
  }
}
