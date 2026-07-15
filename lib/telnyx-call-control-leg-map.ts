// In-process map: inbound Call Control ID → outbound (cell) dial leg.
// Used so call.hangup on the caller can immediately hang up the ringing PSTN leg.
// Softens Vercel cold-start gaps when client_state_update has not landed yet.

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

/** Remember the dialed cell leg for this inbound caller leg. */
export function rememberOutboundDialLeg(inboundCallControlId: string, outboundCallControlId: string): void {
  const inbound = inboundCallControlId.trim()
  const outbound = outboundCallControlId.trim()
  if (!inbound || !outbound) return
  pruneExpired()
  inboundToOutbound.set(inbound, {
    outboundCallControlId: outbound,
    expiresAtMs: Date.now() + TTL_MS,
  })
}

/** Look up the active outbound dial leg for an inbound caller. */
export function lookupOutboundDialLeg(inboundCallControlId: string): string | null {
  const inbound = inboundCallControlId.trim()
  if (!inbound) return null
  pruneExpired()
  const entry = inboundToOutbound.get(inbound)
  if (!entry) return null
  if (entry.expiresAtMs <= Date.now()) {
    inboundToOutbound.delete(inbound)
    return null
  }
  return entry.outboundCallControlId
}

/** Clear mapping after either leg ends. */
export function forgetOutboundDialLeg(inboundCallControlId: string): void {
  const inbound = inboundCallControlId.trim()
  if (!inbound) return
  inboundToOutbound.delete(inbound)
}
