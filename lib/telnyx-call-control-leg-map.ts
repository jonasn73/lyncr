// In-process + Neon map: inbound Call Control ID → outbound (cell) dial leg.
// Neon makes hangup reliable across Vercel serverless instances.

import {
  deleteTelnyxCallLegLink,
  getTelnyxOutboundLegForInbound,
  upsertTelnyxCallLegLink,
} from "@/lib/db"

type LegEntry = {
  outboundCallControlId: string
  expiresAtMs: number
}

const TTL_MS = 15 * 60 * 1000
const inboundToOutbound = new Map<string, LegEntry>()

function pruneExpired(now = Date.now()): void {
  for (const [key, entry] of inboundToOutbound) {
    if (entry.expiresAtMs <= now) inboundToOutbound.delete(key)
  }
}

/** Remember the dialed cell leg for this inbound caller leg (memory + Neon). */
export async function rememberOutboundDialLeg(
  inboundCallControlId: string,
  outboundCallControlId: string,
  callSessionId?: string | null
): Promise<void> {
  const inbound = inboundCallControlId.trim()
  const outbound = outboundCallControlId.trim()
  if (!inbound || !outbound) return
  pruneExpired()
  inboundToOutbound.set(inbound, {
    outboundCallControlId: outbound,
    expiresAtMs: Date.now() + TTL_MS,
  })
  try {
    await upsertTelnyxCallLegLink({
      inboundCallControlId: inbound,
      outboundCallControlId: outbound,
      callSessionId,
    })
  } catch (e) {
    console.error("[telnyx-cc] persist outbound dial leg failed:", e)
  }
}

/** Look up the active outbound dial leg for an inbound caller (memory, then Neon). */
export async function lookupOutboundDialLeg(inboundCallControlId: string): Promise<string | null> {
  const inbound = inboundCallControlId.trim()
  if (!inbound) return null
  pruneExpired()
  const entry = inboundToOutbound.get(inbound)
  if (entry && entry.expiresAtMs > Date.now()) return entry.outboundCallControlId
  if (entry) inboundToOutbound.delete(inbound)
  return getTelnyxOutboundLegForInbound(inbound)
}

/** Clear mapping after either leg ends. */
export async function forgetOutboundDialLeg(inboundCallControlId: string): Promise<void> {
  const inbound = inboundCallControlId.trim()
  if (!inbound) return
  inboundToOutbound.delete(inbound)
  await deleteTelnyxCallLegLink(inbound)
}
