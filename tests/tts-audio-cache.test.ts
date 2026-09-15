import { describe, expect, it, vi, beforeEach } from "vitest"

const sqlCalls: { strings: TemplateStringsArray; values: unknown[] }[] = []
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  sqlCalls.push({ strings, values })
  return Promise.resolve([] as unknown[])
})

vi.mock("@neondatabase/serverless", () => ({
  neon: () => sqlMock,
}))
vi.mock("@/lib/neon-database-url", () => ({
  resolveNeonDatabaseUrl: () => "postgres://test",
}))
vi.mock("@vercel/blob", () => ({
  put: vi.fn(() =>
    Promise.resolve({ url: "https://blob.example/tts-cache/fake.mp3" })
  ),
}))
const telnyxSynthesizeSpeechPreviewMock = vi.fn((_text: string, _voice: string) =>
  Promise.resolve({ buffer: new ArrayBuffer(8), contentType: "audio/mpeg" })
)
vi.mock("@/lib/telnyx-voice-ai-api", () => ({
  telnyxSynthesizeSpeechPreview: telnyxSynthesizeSpeechPreviewMock,
}))

describe("tts-audio-cache phonetic cleanup", () => {
  beforeEach(() => {
    sqlCalls.length = 0
    sqlMock.mockClear()
    telnyxSynthesizeSpeechPreviewMock.mockClear()
    vi.stubEnv("BLOB_STORE_ID", "store_test")
  })

  it("looks up the cache key computed from spoken (phoneticized) text, not raw digits", async () => {
    const { getCachedTtsAudioUrl } = await import("@/lib/tts-audio-cache")
    await getCachedTtsAudioUrl("Thanks for calling Key Squad 502.", "Telnyx.NaturalHD.astra", "en-US")

    expect(sqlCalls).toHaveLength(1)
    const lookedUpKey = sqlCalls[0]!.values[0]
    expect(typeof lookedUpKey).toBe("string")
    expect(lookedUpKey).not.toBe("Thanks for calling Key Squad 502.")
  })

  it("synthesizes and stores phoneticized text, and the stored key matches a lookup for the same raw input", async () => {
    const { getCachedTtsAudioUrl, populateTtsAudioCache } = await import("@/lib/tts-audio-cache")
    const raw = "Thanks for calling Key Squad 502."

    await populateTtsAudioCache(raw, "Telnyx.NaturalHD.astra", "en-US")

    // telnyxSynthesizeSpeechPreview must receive the phoneticized text, never raw "502" digits —
    // that's the exact bug a real test call caught (Telnyx TTS read "502" as "five hundred and two").
    const [synthText] = telnyxSynthesizeSpeechPreviewMock.mock.calls[0]!
    expect(synthText).toContain("five oh two")
    expect(synthText).not.toContain("502")

    const insertCall = sqlCalls.find((c) => c.strings.join("").includes("INSERT INTO tts_audio_cache"))
    expect(insertCall).toBeTruthy()
    const [insertedKey, , , insertedSpokenText] = insertCall!.values
    expect(insertedSpokenText).toContain("five oh two")

    sqlCalls.length = 0
    await getCachedTtsAudioUrl(raw, "Telnyx.NaturalHD.astra", "en-US")
    const lookedUpKey = sqlCalls[0]!.values[0]
    expect(lookedUpKey).toBe(insertedKey)
  })

  it("skips rendering (no Telnyx call) when neither Blob credential env var is set", async () => {
    vi.unstubAllEnvs()
    const { populateTtsAudioCache } = await import("@/lib/tts-audio-cache")
    await populateTtsAudioCache("Thanks for calling Key Squad 502.", "Telnyx.NaturalHD.astra", "en-US")
    expect(telnyxSynthesizeSpeechPreviewMock).not.toHaveBeenCalled()
  })
})
