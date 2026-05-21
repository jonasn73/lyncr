import { getAppUrl } from "@/lib/telnyx"

/** G.711 μ-law (PCMU) — best PSTN clarity; comma-list allows Telnyx to offer only these codecs. */
export function readInboundDialPreferredCodecs(): string {
  const raw = (process.env.ZING_INBOUND_DIAL_PREFERRED_CODECS || "PCMU").trim()
  return raw || "PCMU"
}

/**
 * Symmetric RTP on the outbound PSTN leg — keeps media paths aligned after the bridge.
 * Set `ZING_INBOUND_DIAL_RTP_SYMMETRIC=0` to disable if a carrier rejects the attribute.
 */
export function readInboundDialRtpSymmetric(): boolean {
  const raw = (process.env.ZING_INBOUND_DIAL_RTP_SYMMETRIC || "").trim().toLowerCase()
  if (raw === "0" || raw === "false" || raw === "no") return false
  return true
}

/**
 * Comfort Noise Generation (CNG) on bridged PSTN legs — prevents dead-air during handoffs.
 * Default off on inbound — CNG can sound like an audible “tone change” when the B-leg starts ringing.
 * Enable with `ZING_INBOUND_COMFORT_NOISE=1`.
 */
export function readInboundComfortNoiseEnabled(): boolean {
  const raw = (process.env.ZING_INBOUND_COMFORT_NOISE || "").trim().toLowerCase()
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  return false
}

/** Adaptive jitter buffer for cellular callers (Telnyx extended media attributes). Default off — can cause garbled audio on some carriers. */
export function readInboundJitterBufferConfig(): {
  enabled: boolean
  mode: "adaptive"
  minMs: number
  maxMs: number
} {
  const raw = (process.env.ZING_INBOUND_JITTER_BUFFER || "").trim().toLowerCase()
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off" || raw === "") {
    return { enabled: false, mode: "adaptive", minMs: 40, maxMs: 200 }
  }
  const minMs = Math.max(40, Math.min(400, parseInt(process.env.ZING_INBOUND_JITTER_BUFFER_MIN_MS || "40", 10) || 40))
  const maxMs = Math.max(
    minMs,
    Math.min(400, parseInt(process.env.ZING_INBOUND_JITTER_BUFFER_MAX_MS || "200", 10) || 200)
  )
  return { enabled: true, mode: "adaptive", minMs, maxMs }
}

/** Extra Telnyx media attributes shared by `<Dial>` and `<Number>` on forwarded legs. */
export function buildBridgedLegMediaAttributes(): Record<string, string | boolean | number> {
  const out: Record<string, string | boolean | number> = {}
  if (readInboundComfortNoiseEnabled()) {
    out.comfort_noise_generation = true
    out.enable_cng = true
  }
  const jitter = readInboundJitterBufferConfig()
  if (jitter.enabled) {
    out.enable_jitter_buffer = true
    out.jitter_buffer_mode = jitter.mode
    out.jitterbuffer_msec_min = jitter.minMs
    out.jitterbuffer_msec_max = jitter.maxMs
  }
  return out
}

/** US ringback while the B-leg is ringing (`answerOnBridge` preserves caller-side ringing). */
export function readInboundDialRingTone(): string {
  const raw = (process.env.ZING_INBOUND_DIAL_RING_TONE || "us").trim()
  return raw || "us"
}

/**
 * Ring seconds on the fast inbound `<Dial>` (Telnyx `timeout` attribute, 5–120).
 * Uses routing snapshot first; override with `ZING_INBOUND_FAST_DIAL_TIMEOUT=20` if needed.
 */
export function resolveInboundFastDialTimeoutSeconds(ringTimeoutFromRouting: number): number {
  const raw = (process.env.ZING_INBOUND_FAST_DIAL_TIMEOUT || "").trim()
  if (raw) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 5 && n <= 120) return n
  }
  const ring = Number(ringTimeoutFromRouting) || 30
  return Math.max(5, Math.min(120, ring))
}

/** Fast inbound PSTN forward always bridges with US ringback — no dead air before B-leg rings. */
export function readInboundFastDialAnswerOnBridge(): boolean {
  return true
}

/**
 * Optional second routing_config read on `/incoming` (can add 80–200ms before `<Dial>`).
 * Default off — `getIncomingRoutingByNumber` already merges per-DID + default rows in one query.
 */
export function readInboundRoutingCfgOverlayEnabled(): boolean {
  const raw = (process.env.ZING_INBOUND_ROUTING_CFG_OVERLAY || "").trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

/**
 * Two-phase inbound: optional instant `<Redirect>` before DB routing (pass 2 adds `<Dial>`).
 * Default **off** — `<Play loop>` before `<Redirect>` blocks pass 2 forever on Telnyx (call never forwards).
 * Enable with `ZING_INBOUND_EARLY_MEDIA=1` for redirect-only pass 1 (no `<Play>`).
 */
export function readInboundEarlyMediaEnabled(): boolean {
  const raw = (process.env.ZING_INBOUND_EARLY_MEDIA || "").trim().toLowerCase()
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  return false
}

/** Optional pass-1 ring URL — only used when explicitly set (never loop; blocks Redirect if misconfigured). */
export function readInboundEarlyMediaRingUrl(): string | null {
  const custom = process.env.ZING_INBOUND_EARLY_MEDIA_RING_URL?.trim()
  return custom || null
}

export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/** Pass 1 — instant redirect to pass 2 (never `<Play loop>` before redirect; that blocks forwarding). */
export function buildInboundEarlyMediaTexml(continueUrl: string): string {
  const safeUrl = escapeXmlAttr(continueUrl)
  const ringUrl = readInboundEarlyMediaRingUrl()
  if (ringUrl) {
    const safeRing = escapeXmlAttr(ringUrl)
    // Single play once, then redirect — loop must not be used (blocks Redirect on Telnyx).
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play loop="1">${safeRing}</Play>
  <Redirect method="POST">${safeUrl}</Redirect>
</Response>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${safeUrl}</Redirect>
</Response>`
}

/** Build continue URL for routing pass 2 (preserves query string, adds zingRoute=1). */
export function buildInboundRoutingContinueUrl(reqUrl: string): string {
  const url = new URL(reqUrl)
  url.searchParams.set("zingRoute", "1")
  return url.toString()
}

/** Shared `<Dial>` attributes for inbound PSTN forwarding — ringback + bridge timing. */
export function buildInboundPstnDialAttributes(opts: {
  callerId?: string
  fromDisplayName?: string
  answerOnBridge: boolean
  timeout: number
  action: string
  method?: "GET" | "POST"
}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {
    answerOnBridge: opts.answerOnBridge,
    timeout: opts.timeout,
    action: opts.action,
    method: opts.method ?? "POST",
    ...buildBridgedLegMediaAttributes(),
  }
  // Telnyx has no `fork` attribute — multiple `<Number>` nouns dial simultaneously by default.
  // Ringback to the caller only when we deliberately defer answering (answerOnBridge=true).
  if (opts.answerOnBridge) {
    out.ringTone = readInboundDialRingTone()
  }
  if (opts.callerId) out.callerId = opts.callerId
  if (opts.fromDisplayName) out.fromDisplayName = opts.fromDisplayName
  return out
}

/** Telnyx-extended `<Number>` attributes for codec + symmetric RTP on the forwarded leg. */
export function buildInboundPstnNumberAttributes(): Record<string, string | boolean | number> {
  const out: Record<string, string | boolean | number> = {
    preferred_codecs: readInboundDialPreferredCodecs(),
    ...buildBridgedLegMediaAttributes(),
  }
  if (readInboundDialRtpSymmetric()) {
    out.rtp_symmetric = true
  }
  return out
}

/** Serialize TeXML attribute map → space-separated `key="value"` fragment (hot path — no VoiceResponse). */
function serializeTexmlAttrs(attrs: Record<string, string | number | boolean>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === undefined || value === null) continue
    if (value === true) {
      parts.push(`${key}="true"`)
    } else {
      parts.push(`${key}="${escapeXmlAttr(String(value))}"`)
    }
  }
  return parts.join(" ")
}

/**
 * Fast inbound `<Dial><Number>` TeXML — PCMU + symmetric RTP inline, no VoiceResponse or regex finalize.
 * Used on the cache-hit hot path so Telnyx starts the receptionist PSTN leg sooner.
 */
export function buildFastReceptionistDialTexml(opts: {
  callerId?: string
  answerOnBridge: boolean
  timeout: number
  action: string
  receptionistE164: string
}): string {
  const dialAttrs = buildInboundPstnDialAttributes({
    ...(opts.callerId ? { callerId: opts.callerId } : {}),
    answerOnBridge: opts.answerOnBridge,
    timeout: opts.timeout,
    action: opts.action,
    method: "POST",
  })
  const numberAttrs = buildInboundPstnNumberAttributes()
  const dialAttrStr = serializeTexmlAttrs(dialAttrs)
  const numberAttrStr = serializeTexmlAttrs(numberAttrs)
  const phone = opts.receptionistE164.trim()
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial ${dialAttrStr}>
    <Number ${numberAttrStr}>${phone}</Number>
  </Dial>
</Response>`
}

/** Inject Telnyx media attributes onto `<Dial>` and `<Number>` tags in generated TeXML. */
export function finalizeInboundTexmlXml(xml: string): string {
  const codecs = readInboundDialPreferredCodecs()
  const symmetric = readInboundDialRtpSymmetric()
  const comfort = readInboundComfortNoiseEnabled()
  const jitter = readInboundJitterBufferConfig()

  let out = xml.replace(/<Dial(\s[^>]*>|>)/g, (match) => injectMediaAttrsOnTag(match, "Dial", { comfort, jitter }))
  out = out.replace(/<Number(\s[^>]*>|>)/g, (match) =>
    injectMediaAttrsOnTag(match, "Number", { codecs, symmetric, comfort, jitter })
  )
  return out
}

function injectMediaAttrsOnTag(
  match: string,
  tag: "Dial" | "Number",
  opts: {
    codecs?: string
    symmetric?: boolean
    comfort: boolean
    jitter: ReturnType<typeof readInboundJitterBufferConfig>
  }
): string {
  let extra = ""
  if (tag === "Number" && opts.codecs && !/preferred_codecs=/.test(match)) {
    extra += ` preferred_codecs="${escapeXmlAttr(opts.codecs)}"`
  }
  if (tag === "Number" && opts.symmetric && !/rtp_symmetric=/.test(match)) {
    extra += ` rtp_symmetric="true"`
  }
  if (opts.comfort && !/comfort_noise_generation=/.test(match) && !/enable_cng=/.test(match)) {
    extra += ` comfort_noise_generation="true" enable_cng="true"`
  }
  if (opts.jitter.enabled && !/enable_jitter_buffer=/.test(match)) {
    extra += ` enable_jitter_buffer="true" jitter_buffer_mode="${opts.jitter.mode}" jitterbuffer_msec_min="${opts.jitter.minMs}" jitterbuffer_msec_max="${opts.jitter.maxMs}"`
  }
  if (!extra) return match
  return match.replace(`<${tag}`, `<${tag}${extra}`)
}

/** Log-friendly app base URL (used when building early-media continue links). */
export function inboundVoiceAppBaseUrl(): string {
  return getAppUrl()
}