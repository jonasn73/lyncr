// ============================================
// Client-safe hold-queue Answer unlock helpers
// ============================================
// Keep this file free of Telnyx/Twilio imports so Lines UI can import it.

import { envLyncrOrZing } from "@/lib/lyncr-env"

/**
 * How long Lines keeps Answer locked while status is still `holding`
 * (Busy menu greeting / gather). After this, Answer unlocks even if
 * gather.ended never promoted the row to `waiting` yet.
 */
export function busyMenuAnswerUnlockMs(): number {
  const raw = Number(envLyncrOrZing("BUSY_MENU_ANSWER_UNLOCK_MS") || "8000")
  if (!Number.isFinite(raw)) return 8_000
  // 3–20s — long enough for a short greeting, never minutes.
  return Math.min(20_000, Math.max(3_000, Math.floor(raw)))
}

/**
 * Whether Lines Answer is allowed for this queue row.
 * - waiting → yes
 * - holding → yes after busyMenuAnswerUnlockMs() (past greeting window)
 * - bridging → no (already connecting)
 */
export function isHoldQueueAnswerable(
  status: string,
  enqueuedAt: string | Date | null | undefined,
  nowMs: number = Date.now()
): boolean {
  const s = String(status || "").trim().toLowerCase()
  if (s === "waiting") return true
  if (s !== "holding") return false
  const t =
    enqueuedAt instanceof Date ? enqueuedAt.getTime() : new Date(String(enqueuedAt || "")).getTime()
  if (!Number.isFinite(t)) return false
  return nowMs - t >= busyMenuAnswerUnlockMs()
}
