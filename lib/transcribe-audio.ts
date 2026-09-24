// ============================================
// Background audio transcription (Telnyx Speech-to-Text)
// ============================================
// Downloads a call recording and transcribes it via Telnyx's audio transcription API. Used by the
// voice wrap-up flow to turn the operator's spoken job note into text for call_logs.internal_notes.
// Returns null (and logs) when TELNYX_API_KEY is missing or any step fails — callers fall back to
// storing the raw recording link.

const TRANSCRIBE_MODEL = process.env.LYNCR_TRANSCRIBE_MODEL?.trim() || "distil-whisper/distil-large-v2"

/** Telnyx recording URLs sometimes need `.mp3`; normalize to a fetchable audio URL. */
function normalizeRecordingUrl(url: string): string {
  const u = url.trim()
  if (!u) return u
  const path = u.split(/[?#]/, 1)[0]
  if (/\.(mp3|wav|ogg|m4a)$/i.test(path)) return u
  // Telnyx can return a presigned S3 URL. Its path and query must remain byte-for-byte
  // intact or S3 rejects the download before transcription ever starts.
  if (/[?&](?:X-Amz-Signature|Signature)=/i.test(u)) return u
  return `${path}.mp3${u.slice(path.length)}`
}

async function transcribeAudioBuffer(audioBuf: ArrayBuffer): Promise<string | null> {
  const apiKey = process.env.TELNYX_API_KEY?.trim()
  if (!apiKey) {
    console.warn("[transcribe] TELNYX_API_KEY missing — storing recording link instead of transcript.")
    return null
  }
  if (audioBuf.byteLength === 0) return null

  const form = new FormData()
  form.set("model", TRANSCRIBE_MODEL)
  form.set("response_format", "json")
  form.set("file", new Blob([audioBuf], { type: "audio/mpeg" }), "clip.mp3")

  const res = await fetch("https://api.telnyx.com/v2/ai/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    console.error(`[transcribe] Telnyx STT ${res.status}: ${text.slice(0, 240)}`)
    return null
  }
  const body = await res.json().catch(() => null) as { text?: unknown } | null
  const transcript = typeof body?.text === "string" ? body.text.trim() : ""
  return transcript.length > 0 ? transcript : null
}

/** TeXML `<Record>` callback URLs (RecordingUrl) — fetchable with no auth. */
export async function transcribeRecording(recordingUrl: string): Promise<string | null> {
  const url = normalizeRecordingUrl(recordingUrl)
  try {
    const audioRes = await fetch(url)
    if (!audioRes.ok) {
      console.error(`[transcribe] recording fetch failed ${audioRes.status} for ${url}`)
      return null
    }
    return await transcribeAudioBuffer(await audioRes.arrayBuffer())
  } catch (e) {
    console.error("[transcribe] failed:", e)
    return null
  }
}

/**
 * Call Control `call.recording.saved` clips can use either a presigned recording
 * URL or a Telnyx URL that requires the API key as Bearer auth.
 */
export async function transcribeTelnyxRecording(recordingUrl: string): Promise<string | null> {
  const url = normalizeRecordingUrl(recordingUrl)
  const isPresigned = /[?&](?:X-Amz-Signature|Signature)=/i.test(url)
  const apiKey = process.env.TELNYX_API_KEY?.trim()
  if (!isPresigned && !apiKey) {
    console.warn("[transcribe] TELNYX_API_KEY missing — cannot download Call Control recording.")
    return null
  }
  try {
    const audioRes = await fetch(url, isPresigned ? undefined : { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!audioRes.ok) {
      // Signed query strings are credentials; do not put them in runtime logs.
      console.error(`[transcribe] telnyx recording fetch failed ${audioRes.status} for ${url.split(/[?#]/, 1)[0]}`)
      return null
    }
    return await transcribeAudioBuffer(await audioRes.arrayBuffer())
  } catch (e) {
    // Fetch errors can include the signed URL; log only the error type.
    console.error("[transcribe] telnyx recording failed:", e instanceof Error ? e.name : "unknown")
    return null
  }
}
