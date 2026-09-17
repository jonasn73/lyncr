// ============================================
// Background audio transcription (OpenAI)
// ============================================
// Downloads a call recording and transcribes it via OpenAI's audio transcription API. Used by the
// voice wrap-up flow to turn the operator's spoken job note into text for call_logs.internal_notes.
// Returns null (and logs) when OPENAI_API_KEY is missing or any step fails — callers fall back to
// storing the raw recording link.

const TRANSCRIBE_MODEL = process.env.LYNCR_TRANSCRIBE_MODEL?.trim() || "whisper-1"

/** Telnyx recording URLs sometimes need `.mp3`; normalize to a fetchable audio URL. */
function normalizeRecordingUrl(url: string): string {
  const u = url.trim()
  if (!u) return u
  if (/\.(mp3|wav|ogg|m4a)$/i.test(u)) return u
  return `${u}.mp3`
}

async function transcribeAudioBuffer(audioBuf: ArrayBuffer): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    console.warn("[transcribe] OPENAI_API_KEY missing — storing recording link instead of transcript.")
    return null
  }
  if (audioBuf.byteLength === 0) return null

  const form = new FormData()
  form.set("model", TRANSCRIBE_MODEL)
  form.set("response_format", "text")
  form.set("file", new Blob([audioBuf], { type: "audio/mpeg" }), "clip.mp3")

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    console.error(`[transcribe] OpenAI ${res.status}: ${text.slice(0, 240)}`)
    return null
  }
  const transcript = (await res.text()).trim()
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
 * Call Control `call.recording.saved` clips (recording_urls.mp3) — unlike TeXML's
 * RecordingUrl, these 404/401 without the Telnyx API key as Bearer auth.
 */
export async function transcribeTelnyxRecording(recordingUrl: string): Promise<string | null> {
  const url = normalizeRecordingUrl(recordingUrl)
  const apiKey = process.env.TELNYX_API_KEY?.trim()
  if (!apiKey) {
    console.warn("[transcribe] TELNYX_API_KEY missing — cannot download Call Control recording.")
    return null
  }
  try {
    const audioRes = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!audioRes.ok) {
      console.error(`[transcribe] telnyx recording fetch failed ${audioRes.status} for ${url}`)
      return null
    }
    return await transcribeAudioBuffer(await audioRes.arrayBuffer())
  } catch (e) {
    console.error("[transcribe] telnyx recording failed:", e)
    return null
  }
}
