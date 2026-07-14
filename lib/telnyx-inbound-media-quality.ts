import { getAppUrl } from "@/lib/telnyx"
import { prependInboundCallerGreetingToResponseTexml } from "@/lib/inbound-branded-greeting"

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
 * Optional custom ringback WAV/MP3 URL on `<Dial>` (Telnyx `audioUrl` — overrides `ringTone` when set).
 * Example: `ZING_INBOUND_DIAL_RINGBACK_AUDIO_URL=https://lyncr.app/audio/us-ringback.wav`
 */
export function readInboundDialRingbackAudioUrl(): string | null {
  const raw = (process.env.ZING_INBOUND_DIAL_RINGBACK_AUDIO_URL || "").trim()
  return raw || null
}

/** Telnyx TeXML ringback attrs — native `ringTone` or custom `audioUrl` (no `ringbackTone` in schema). */
export function buildInboundDialRingbackAttributes(): Record<string, string> {
  const audioUrl = readInboundDialRingbackAudioUrl()
  if (audioUrl) return { audioUrl }
  return { ringTone: readInboundDialRingTone() }
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

/**
 * When AI is the no-answer fallback, cap PSTN ring time (~4 rings) before `/fallback` → AI bridge.
 * Default cap: 20s (`ZING_INBOUND_AI_DIAL_TIMEOUT`).
 */
export function resolveInboundForwardDialTimeoutSeconds(
  ringTimeoutFromRouting: number,
  wantsAiAfterNoAnswer: boolean
): number {
  if (!wantsAiAfterNoAnswer) {
    return resolveInboundFastDialTimeoutSeconds(ringTimeoutFromRouting)
  }
  const raw = (process.env.ZING_INBOUND_AI_DIAL_TIMEOUT || "20").trim()
  const aiCap = parseInt(raw, 10)
  const cap = Number.isFinite(aiCap) && aiCap >= 5 && aiCap <= 120 ? aiCap : 20
  const ring = Number(ringTimeoutFromRouting) || 30
  return Math.min(ring, cap)
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
  sequential?: boolean
  /** When false, omit `ringTone` so the caller hears hold silence instead of US ringback. */
  includeRingback?: boolean
}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {
    answerOnBridge: opts.answerOnBridge,
    timeout: opts.timeout,
    action: opts.action,
    method: opts.method ?? "POST",
    ...buildBridgedLegMediaAttributes(),
  }
  // Telnyx has no `ringbackTone` — use native `ringTone="us"` or optional `audioUrl` during B-leg setup.
  if (opts.answerOnBridge && opts.includeRingback !== false) {
    Object.assign(out, buildInboundDialRingbackAttributes())
  }
  if (opts.callerId) out.callerId = opts.callerId
  if (opts.fromDisplayName) out.fromDisplayName = opts.fromDisplayName
  if (opts.sequential) out.sequential = true
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

/** Dial-leg progress webhooks → `/api/voice/telnyx/status` (initiated / ringing / answered / completed). */
export function buildInboundDialLegStatusCallbackAttributes(
  statusCallbackUrl?: string | null
): Record<string, string> {
  const base = getAppUrl().replace(/\/+$/, "")
  const url = (statusCallbackUrl?.trim() || `${base}/api/voice/telnyx/status`).trim()
  return {
    statusCallback: url,
    statusCallbackMethod: "POST",
    statusCallbackEvent: "initiated ringing answered completed",
  }
}

/** `<Number url method="POST">` — Telnyx TeXML apps usually POST; without `method` the screen URL may never run. */
export function buildInboundPstnNumberAttributesWithAnswerUrl(
  answerUrl?: string,
  opts?: { statusCallbackUrl?: string | null; includeStatusCallback?: boolean }
): Record<string, string | boolean | number> {
  const out = buildInboundPstnNumberAttributes()
  const url = answerUrl?.trim()
  if (url) {
    out.url = url
    out.method = "POST"
  }
  if (opts?.includeStatusCallback !== false) {
    Object.assign(out, buildInboundDialLegStatusCallbackAttributes(opts?.statusCallbackUrl))
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
  /** Telnyx fetches this on the callee leg the instant they answer (whisper + realtime HUD trigger). */
  answerUrl?: string
  /** Optional branded `<Say>` played to the caller before `<Dial>`. */
  callerGreeting?: string
  /** When false, caller hears silence while the B-leg rings (after greeting pass). */
  includeRingback?: boolean
}): string {
  const dialAttrs = buildInboundPstnDialAttributes({
    ...(opts.callerId ? { callerId: opts.callerId } : {}),
    answerOnBridge: opts.answerOnBridge,
    timeout: opts.timeout,
    action: opts.action,
    method: "POST",
    includeRingback: opts.includeRingback,
  })
  const numberAttrs = buildInboundPstnNumberAttributesWithAnswerUrl(opts.answerUrl)
  const dialAttrStr = serializeTexmlAttrs(dialAttrs)
  const numberAttrStr = serializeTexmlAttrs(numberAttrs)
  const phone = opts.receptionistE164.trim()
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial ${dialAttrStr}>
    <Number ${numberAttrStr}>${phone}</Number>
  </Dial>
</Response>`
  if (opts.callerGreeting?.trim()) {
    xml = prependInboundCallerGreetingToResponseTexml(xml, opts.callerGreeting.trim())
  }
  return xml
}

/**
 * SIP domain receptionist browsers register to (a Telnyx Credential Connection's SIP domain).
 * Defaults to Telnyx's shared `sip.telnyx.com`; override per-account/connection via env.
 */
export function readTelnyxWebRtcSipDomain(): string {
  const raw = (process.env.TELNYX_WEBRTC_SIP_DOMAIN || "").trim()
  return raw || "sip.telnyx.com"
}

/**
 * Build the `sip:` URI for a receptionist's registered browser.
 * Returns null when no `sip_username` is provisioned — the caller must then fall back to PSTN
 * so a WEB receptionist without a live SIP endpoint never results in a dropped call.
 */
export function resolveReceptionistSipUri(sipUsername: string | null | undefined): string | null {
  const user = String(sipUsername ?? "").trim()
  if (!user) return null
  // Allow a fully-qualified URI to pass through; otherwise assemble sip:<user>@<domain>.
  if (/^sips?:/i.test(user)) return user
  return `sip:${user}@${readTelnyxWebRtcSipDomain()}`
}

/**
 * Fast inbound `<Dial><Sip>` TeXML — rings the receptionist's registered browser over Telnyx WebRTC.
 * Mirrors the PSTN builder's Dial attributes + `action`, so a no-answer still falls through to the
 * existing owner / AI / voicemail fallback chain exactly like a cell forward does.
 */
export function buildFastReceptionistDialWebRtcTexml(opts: {
  callerId?: string
  answerOnBridge: boolean
  timeout: number
  action: string
  sipUri: string
  /** Telnyx fetches this on the callee leg the instant they answer (whisper + realtime HUD trigger). */
  answerUrl?: string
  /** Optional branded `<Say>` played to the caller before `<Dial>`. */
  callerGreeting?: string
  includeRingback?: boolean
}): string {
  // Same Dial-level attributes as a cell forward: ringback, bridge timing, and the fallback action URL.
  const dialAttrs = buildInboundPstnDialAttributes({
    ...(opts.callerId ? { callerId: opts.callerId } : {}),
    answerOnBridge: opts.answerOnBridge,
    timeout: opts.timeout,
    action: opts.action,
    method: "POST",
    includeRingback: opts.includeRingback,
  })
  const sipAttrs: Record<string, string> = {}
  if (opts.answerUrl?.trim()) {
    sipAttrs.url = opts.answerUrl.trim()
    sipAttrs.method = "POST"
  }
  const dialAttrStr = serializeTexmlAttrs(dialAttrs)
  const sipAttrStr = serializeTexmlAttrs(sipAttrs)
  const uri = escapeXmlAttr(opts.sipUri.trim())
  const sipOpen = sipAttrStr ? `<Sip ${sipAttrStr}>` : "<Sip>"
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial ${dialAttrStr}>
    ${sipOpen}${uri}</Sip>
  </Dial>
</Response>`
  if (opts.callerGreeting?.trim()) {
    xml = prependInboundCallerGreetingToResponseTexml(xml, opts.callerGreeting.trim())
  }
  return xml
}

/**
 * Skill-pool inbound TeXML — dials one or many receptionist PSTN legs sequentially or simultaneously.
 */
export function buildRoutingPoolDialTexml(opts: {
  callerId?: string
  answerOnBridge: boolean
  timeout: number
  action: string
  receptionistE164List: string[]
  mode: "sequential" | "simultaneous"
  /** Optional per-number `url` (whisper + realtime HUD trigger), keyed by E.164. */
  answerUrlByE164?: Record<string, string>
  /** Optional branded `<Say>` played to the caller before `<Dial>`. */
  callerGreeting?: string
  includeRingback?: boolean
}): string {
  const phones = opts.receptionistE164List.map((p) => p.trim()).filter((p) => p.length > 0)
  if (phones.length === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
  }
  const dialAttrs = buildInboundPstnDialAttributes({
    ...(opts.callerId ? { callerId: opts.callerId } : {}),
    answerOnBridge: opts.answerOnBridge,
    timeout: opts.timeout,
    action: opts.action,
    method: "POST",
    ...(opts.mode === "sequential" ? { sequential: true } : {}),
    includeRingback: opts.includeRingback,
  })
  const dialAttrStr = serializeTexmlAttrs(dialAttrs)
  const numberTags = phones
    .map((phone) => {
      const answerUrl = opts.answerUrlByE164?.[phone]
      const attrs = buildInboundPstnNumberAttributesWithAnswerUrl(answerUrl)
      return `    <Number ${serializeTexmlAttrs(attrs)}>${phone}</Number>`
    })
    .join("\n")
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial ${dialAttrStr}>
${numberTags}
  </Dial>
</Response>`
  if (opts.callerGreeting?.trim()) {
    xml = prependInboundCallerGreetingToResponseTexml(xml, opts.callerGreeting.trim())
  }
  return xml
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