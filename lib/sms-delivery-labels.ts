// Client-safe labels for outbound SMS delivery status (no server/DB imports).

/** Human label for Messages bubbles. */
export function formatSmsDeliveryLabel(msg: {
  direction: string
  status: string
  delivered_at?: string | null
  failed_at?: string | null
}): string | null {
  if (msg.direction !== "outbound") return null
  const s = (msg.status || "").toLowerCase()
  if (s === "delivered" || msg.delivered_at) return "Delivered"
  if (s === "failed" || msg.failed_at) return "Failed"
  if (s === "accepted_with_warning") return "Sent (may be blocked)"
  if (s === "sent" || s === "queued") return "Sent"
  return "Sent"
}
