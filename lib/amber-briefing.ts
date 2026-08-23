/**
 * Amber “anything waiting?” briefing — leftover book jobs still open.
 * First names only. No addresses or full phones in SMS.
 */

import { listOwnerRecentBookFormLeads } from "@/lib/db"
import { getOpenAmberJobThread } from "@/lib/amber-coworker-db"
import { amberCustomerFirstName, amberPhoneLast4 } from "@/lib/amber-coworker-commands"
import { isAmberBriefingPhrase } from "@/lib/amber-commands"
import type { AmberWorkspaceRow } from "@/lib/amber-db"

export { isAmberBriefingPhrase }

export type AmberBriefingLine = {
  name: string
  last4: string
  urgency: string
}

/** Format a short SMS. Empty list → you’re clear. */
export function formatAmberBriefingSms(params: {
  busy: boolean
  lines: AmberBriefingLine[]
}): string {
  const status = params.busy ? "You’re Busy." : "You’re Available."
  if (params.lines.length === 0) {
    return `${status} Nothing waiting. You’re clear.`
  }
  const shown = params.lines.slice(0, 3)
  const extra = params.lines.length - shown.length
  const bullets = shown.map((row) => {
    const asap = row.urgency.toLowerCase() === "asap" ? " ASAP" : ""
    const tail = row.last4.length === 4 ? ` · …${row.last4}` : ""
    return `• ${row.name}${tail}${asap}`
  })
  const more = extra > 0 ? `\n+${extra} more on Lines.` : "\nOpen Lines to handle them."
  return `${status}\n\nStill need you:\n${bullets.join("\n")}${more}`
}

/** Hey reply — status plus leftovers so Amber feels awake without a cheat-sheet. */
export function formatAmberHelloSms(params: {
  busy: boolean
  untilLabel: string | null
  lines: AmberBriefingLine[]
  /** Compact "Today: $X, N missed calls." line — optional, dropped when the lookup failed. */
  snapshotLine?: string | null
}): string {
  const status = params.busy
    ? params.untilLabel
      ? `You’re Busy until ${params.untilLabel}. Your phone does not ring first.`
      : "You’re Busy. Your phone does not ring first."
    : "You’re Available. Your phone rings first."
  const snapshot = params.snapshotLine?.trim() ? `\n${params.snapshotLine.trim()}` : ""
  if (params.lines.length === 0) {
    return `Hey.\n${status}${snapshot}\nNothing waiting.`
  }
  const body = formatAmberBriefingSms({ busy: params.busy, lines: params.lines })
  return `Hey.\n${body}${snapshot}`
}

function lineFromLead(params: {
  customerName: string | null
  customerPhone: string | null
  urgency: string
}): AmberBriefingLine {
  return {
    name: amberCustomerFirstName(params.customerName),
    last4: amberPhoneLast4(params.customerPhone),
    urgency: params.urgency,
  }
}

/** Load leftover book jobs for this shop (48h, still lead). */
export async function loadAmberBriefingLines(params: {
  amber: AmberWorkspaceRow
}): Promise<AmberBriefingLine[]> {
  const [thread, leads] = await Promise.all([
    getOpenAmberJobThread({
      userId: params.amber.user_id,
      amberWorkspaceId: params.amber.id,
    }),
    listOwnerRecentBookFormLeads({
      ownerUserId: params.amber.user_id,
      organizationId: params.amber.organization_id,
      maxAgeHours: 48,
      limit: 8,
    }).catch(() => []),
  ])
  const out: AmberBriefingLine[] = []
  const seen = new Set<string>()
  const remember = (row: AmberBriefingLine) => {
    const key = row.last4 !== "????" ? row.last4 : `${row.name}-${out.length}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(row)
  }
  if (thread) {
    remember(
      lineFromLead({
        customerName: thread.customer_name,
        customerPhone: thread.customer_phone,
        urgency: thread.urgency || "asap",
      })
    )
  }
  for (const lead of leads) {
    remember(
      lineFromLead({
        customerName: lead.customerName,
        customerPhone: lead.customerPhone,
        urgency: lead.urgency,
      })
    )
  }
  return out
}
