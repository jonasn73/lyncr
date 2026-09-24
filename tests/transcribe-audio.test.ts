import { afterEach, describe, expect, it, vi } from "vitest"
import { transcribeTelnyxRecording } from "../lib/transcribe-audio"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Telnyx Call Control recording download", () => {
  it("preserves a signed recording URL and omits bearer auth", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-test")
    vi.stubEnv("TELNYX_API_KEY", "telnyx-test")
    const signedUrl = "https://recordings.example/vehicle.mp3?X-Amz-Date=20260924T112900Z&X-Amz-Signature=secret"
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(new Response("2015 Toyota Camry"))
    vi.stubGlobal("fetch", fetchMock)

    expect(await transcribeTelnyxRecording(signedUrl)).toBe("2015 Toyota Camry")
    expect(fetchMock).toHaveBeenNthCalledWith(1, signedUrl, undefined)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({ headers: { Authorization: "Bearer openai-test" } })
    )
  })

  it("adds the format suffix before an unsigned query string", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-test")
    vi.stubEnv("TELNYX_API_KEY", "telnyx-test")
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1])))
      .mockResolvedValueOnce(new Response("2015 Toyota Camry"))
    vi.stubGlobal("fetch", fetchMock)

    expect(await transcribeTelnyxRecording("https://recordings.example/vehicle?download=1"))
      .toBe("2015 Toyota Camry")
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://recordings.example/vehicle.mp3?download=1", {
      headers: { Authorization: "Bearer telnyx-test" },
    })
  })
})
