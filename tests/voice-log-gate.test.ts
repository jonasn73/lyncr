import { describe, expect, it, afterEach, vi } from "vitest"
import { shouldEmitVoiceHotPathDebugLogs } from "@/lib/voice-log-gate"

describe("shouldEmitVoiceHotPathDebugLogs", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("is true when NODE_ENV is not production", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("ZING_VOICE_DEBUG_LOGS", "")
    expect(shouldEmitVoiceHotPathDebugLogs()).toBe(true)
  })

  it("is false in production when ZING_VOICE_DEBUG_LOGS is unset", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ZING_VOICE_DEBUG_LOGS", "")
    expect(shouldEmitVoiceHotPathDebugLogs()).toBe(false)
  })

  it("is true in production when ZING_VOICE_DEBUG_LOGS=1", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ZING_VOICE_DEBUG_LOGS", "1")
    expect(shouldEmitVoiceHotPathDebugLogs()).toBe(true)
  })
})
