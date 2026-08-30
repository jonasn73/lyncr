// Per-business support alerts for the admin Finance home — surfaces "this business needs
// attention" directly on their name, instead of requiring a separate trip to Support.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

export type AdminSupportAlert = {
  /** Business owner's user_id — the thread's own key. */
  ownerUserId: string
  unreadCount: number
  status: "open" | "waiting" | "closed"
  lastMessageAt: string | null
  /** Who sent the most recent message, and their role — the "business/tech" distinction. */
  lastSenderName: string | null
  lastSenderRole: "owner" | "receptionist" | "field_tech" | "admin" | null
  lastMessagePreview: string | null
}

/** One row per business with an open/waiting thread that has unread admin messages. */
export async function getAdminSupportAlertsByOwner(): Promise<Map<string, AdminSupportAlert>> {
  const sql = neon(resolveNeonDatabaseUrl())
  const map = new Map<string, AdminSupportAlert>()
  try {
    const rows = (await sql`
      SELECT
        t.user_id::text AS owner_user_id,
        t.admin_unread_count::int AS unread_count,
        t.status,
        t.last_message_at,
        lm.body AS last_body,
        sender.business_name AS sender_business_name,
        sender.email AS sender_email,
        sender.account_role AS sender_role
      FROM support_chat_threads t
      LEFT JOIN LATERAL (
        SELECT m.body, m.sender_user_id
        FROM support_chat_messages m
        WHERE m.thread_id = t.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) lm ON true
      LEFT JOIN users sender ON sender.id = lm.sender_user_id
      WHERE t.status IN ('open', 'waiting')
        AND t.admin_unread_count > 0
      ORDER BY t.last_message_at DESC NULLS LAST
    `) as {
      owner_user_id: string
      unread_count: number
      status: string
      last_message_at: string | Date | null
      last_body: string | null
      sender_business_name: string | null
      sender_email: string | null
      sender_role: string | null
    }[]

    for (const row of rows) {
      const statusRaw = String(row.status)
      map.set(row.owner_user_id, {
        ownerUserId: row.owner_user_id,
        unreadCount: Number(row.unread_count) || 0,
        status: statusRaw === "waiting" ? "waiting" : statusRaw === "closed" ? "closed" : "open",
        lastMessageAt:
          row.last_message_at instanceof Date
            ? row.last_message_at.toISOString()
            : row.last_message_at,
        lastSenderName:
          (row.sender_business_name ?? "").trim() || (row.sender_email ?? "").trim() || null,
        lastSenderRole:
          row.sender_role === "receptionist" || row.sender_role === "field_tech"
            ? row.sender_role
            : row.sender_role === "owner"
              ? "owner"
              : null,
        lastMessagePreview: (row.last_body ?? "").trim().slice(0, 140) || null,
      })
    }
  } catch (e) {
    console.warn("[admin-support-alerts] query failed:", e)
  }
  return map
}
