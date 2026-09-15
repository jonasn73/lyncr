// Pre-rendered TTS audio cache — generate a clip once via Telnyx TTS, store it in Blob,
// and replay it with <Play> instead of paying live Telnyx synthesis + latency on every call.
// Every function here is best-effort: a miss, a slow Neon/Blob/Telnyx call, or a write failure
// must never block or break the live call that triggered it — callers always keep their
// existing live-<Say> fallback.

import { createHash } from "node:crypto"
import { neon } from "@neondatabase/serverless"
import { put } from "@vercel/blob"
import { after } from "next/server"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { telnyxSynthesizeSpeechPreview } from "@/lib/telnyx-voice-ai-api"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

/**
 * True when @vercel/blob has *some* way to authenticate: a static BLOB_READ_WRITE_TOKEN,
 * or the newer OIDC-based auth (BLOB_STORE_ID + an auto-provided VERCEL_OIDC_TOKEN — this
 * project's store was connected without ever issuing a static token, so BLOB_STORE_ID is
 * the only one present). Don't pass an explicit `token` to `put()` below — omitting it lets
 * the SDK's own auth resolution try OIDC first, then BLOB_READ_WRITE_TOKEN.
 */
function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_STORE_ID?.trim())
}

/** Cache key: exact spoken text + voice + language — any change (e.g. a renamed shop) is a new key. */
export function computeTtsCacheKey(text: string, voice: string, language: string): string {
  return createHash("sha256").update(`${text}\u0000${voice}\u0000${language}`).digest("hex")
}

/** Lookup only. Returns null on a miss OR any failure — never throws. */
export async function getCachedTtsAudioUrl(
  text: string,
  voice: string,
  language: string
): Promise<string | null> {
  try {
    const cacheKey = computeTtsCacheKey(text, voice, language)
    const sql = sqlClient()
    const rows = await sql`SELECT blob_url FROM tts_audio_cache WHERE cache_key = ${cacheKey} LIMIT 1`
    const url = (rows[0] as { blob_url?: unknown } | undefined)?.blob_url
    return typeof url === "string" && url ? url : null
  } catch (e) {
    console.warn("[tts-audio-cache] lookup failed, falling back to live TTS:", e)
    return null
  }
}

/** Synthesize + store one clip. Awaitable for callers that want completion, but never throws. */
export async function populateTtsAudioCache(text: string, voice: string, language: string): Promise<void> {
  const cacheKey = computeTtsCacheKey(text, voice, language)
  if (!isBlobConfigured()) {
    console.warn("[tts-audio-cache] skipped: no BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID at runtime", { cacheKey })
    return
  }
  console.log("[tts-audio-cache] rendering", { cacheKey, voice, language, textLen: text.length })
  try {
    const { buffer, contentType } = await telnyxSynthesizeSpeechPreview(text, voice)
    const ext = contentType.includes("wav") ? "wav" : "mp3"
    const blob = await put(`tts-cache/${cacheKey}.${ext}`, Buffer.from(buffer), {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    const sql = sqlClient()
    await sql`
      INSERT INTO tts_audio_cache (cache_key, blob_url, voice, spoken_text)
      VALUES (${cacheKey}, ${blob.url}, ${voice}, ${text})
      ON CONFLICT (cache_key) DO UPDATE SET blob_url = EXCLUDED.blob_url
    `
    console.log("[tts-audio-cache] cached", { cacheKey, blobUrl: blob.url })
  } catch (e) {
    // Missing table (migration not run yet), Telnyx TTS error, Blob misconfig, etc. — stay silent to logs only.
    console.warn("[tts-audio-cache] background generation failed:", { cacheKey, error: String(e) })
  }
}

/**
 * Fire-and-forget wrapper — call sites on the live-call path must never await generation.
 * Uses Next.js `after()` (not a bare detached promise) so the Telnyx TTS call + Blob upload +
 * DB write are guaranteed to finish even though the webhook response goes back to Telnyx first;
 * a plain `void (async () => {...})()` here risks Vercel freezing the function before it completes.
 * `after()` throws outside an active request scope (tests, scripts) — fall back to a detached
 * promise there so a non-request caller still gets best-effort caching instead of a thrown error.
 */
export function cacheTtsAudioInBackground(text: string, voice: string, language: string): void {
  try {
    after(() => populateTtsAudioCache(text, voice, language))
  } catch (e) {
    console.warn("[tts-audio-cache] after() unavailable, using detached promise fallback:", String(e))
    void populateTtsAudioCache(text, voice, language)
  }
}
