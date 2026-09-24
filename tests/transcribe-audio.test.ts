import { afterEach, describe, expect, it, vi } from "vitest"
import { transcribeTelnyxRecording } from "@/lib/transcribe-audio"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("Telnyx recording transcription", () => {
  it("downloads the call clip and transcribes it with the Telnyx API key", async () => {
    vi.stubEnv("TELNYX_API_KEY", "test-telnyx-key")
    vi.stubEnv("OPENAI_API_KEY", "")
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "2015 Toyota Camry" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
    vi.stubGlobal("fetch", fetchMock)

    const transcript = await transcribeTelnyxRecording("https://recordings.telnyx.com/clip.mp3")

    expect(transcript).toBe("2015 Toyota Camry")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.telnyx.com/v2/ai/audio/transcriptions")
    const request = fetchMock.mock.calls[1][1] as RequestInit
    expect(request.headers).toEqual({ Authorization: "Bearer test-telnyx-key" })
    expect((request.body as FormData).get("model")).toBe("distil-whisper/distil-large-v2")
    expect((request.body as FormData).get("file")).toBeInstanceOf(Blob)
  })
})
