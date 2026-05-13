/**
 * Replays Telnyx Dial `action` payloads against handleTelnyxFallbackDialEnded with mocked DB.
 * Add scenarios in tests/fixtures/telnyx-fallback/scenarios.ts (see README there).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import type { TelnyxFallbackPathOpts } from "@/lib/telnyx-fallback-dial-action"
import * as db from "@/lib/db"
import * as lifecycle from "@/lib/telnyx-ai-assistant-lifecycle"
import { handleTelnyxFallbackDialEnded } from "@/lib/telnyx-fallback-dial-action"
import type { TelnyxFallbackFixture } from "./fixtures/telnyx-fallback/scenarios"
import { telnyxFallbackScenarios } from "./fixtures/telnyx-fallback/scenarios"

vi.mock("@/lib/db", () => {
  const normalizePhoneNumberE164 = (p: string) => {
    const d = p.replace(/\D/g, "")
    if (d.length === 10) return `+1${d}`
    if (d.length === 11 && d.startsWith("1")) return `+${d}`
    if (p.startsWith("+")) return p
    return d ? `+${d}` : p
  }
  return {
    getRoutingConfig: vi.fn(),
    getRoutingConfigForNumber: vi.fn(),
    getIncomingRoutingByNumber: vi.fn(),
    getUser: vi.fn(),
    getPrimaryActiveBusinessNumberE164: vi.fn(),
    updateCallLog: vi.fn(() => Promise.resolve()),
    ensureCallLogForInboundLeg: vi.fn(() => Promise.resolve()),
    normalizePhoneNumberE164,
  }
})

vi.mock("@/lib/telnyx-ai-assistant-lifecycle", () => ({
  ensureTelnyxVoiceAiAssistant: vi.fn(() => Promise.resolve({ linked: false })),
}))

function pathUserIdFromUrl(url: string): string | null {
  const m = url.match(/\/fallback\/u\/([^/?]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

/** Parse `/.../u/{userId}/n/{did}/{mode}` from pathname. */
function pathOptsFromUrl(fullUrl: string): TelnyxFallbackPathOpts {
  const pathname = new URL(fullUrl).pathname
  const parts = pathname.split("/").filter(Boolean)
  const nIdx = parts.indexOf("n")
  if (nIdx >= 0 && parts[nIdx + 1] && parts[nIdx + 2]) {
    return { pathDidDigits: parts[nIdx + 1], pathFallbackMode: parts[nIdx + 2] }
  }
  return {}
}

function buildRequest(scenario: TelnyxFallbackFixture): NextRequest {
  const fd = new FormData()
  for (const [k, v] of Object.entries(scenario.form)) {
    fd.append(k, v)
  }
  return new NextRequest(scenario.url, { method: scenario.method, body: fd })
}

function applyMocks(scenario: TelnyxFallbackFixture) {
  const m = scenario.mocks
  vi.mocked(db.getIncomingRoutingByNumber).mockResolvedValue(m.incomingRouting)
  vi.mocked(db.getRoutingConfigForNumber).mockResolvedValue(m.routingForNumber)
  vi.mocked(db.getRoutingConfig).mockResolvedValue(m.globalRouting)
  vi.mocked(db.getUser).mockResolvedValue(m.user)
  vi.mocked(db.getPrimaryActiveBusinessNumberE164).mockResolvedValue(m.primaryBusinessE164)
  if (m.ensureAssistant) {
    vi.mocked(lifecycle.ensureTelnyxVoiceAiAssistant).mockResolvedValue(m.ensureAssistant as never)
  } else {
    vi.mocked(lifecycle.ensureTelnyxVoiceAiAssistant).mockResolvedValue({ linked: false })
  }
}

describe("handleTelnyxFallbackDialEnded (fixture replay)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.NEXT_PUBLIC_APP_URL = "https://fixture.test"
    delete process.env.TELNYX_AI_ASSISTANT_ID
  })

  it.each(telnyxFallbackScenarios)("$id: $description", async (scenario) => {
    applyMocks(scenario)
    const req = buildRequest(scenario)
    const uid = pathUserIdFromUrl(scenario.url)
    expect(uid).toBeTruthy()
    const opts = pathOptsFromUrl(scenario.url)
    const res = await handleTelnyxFallbackDialEnded(req, uid, opts)
    const body = await res.text()
    const ct = res.headers.get("content-type") || ""
    if (scenario.expect.contentType) {
      expect(ct).toContain(scenario.expect.contentType)
    }
    for (const sub of scenario.expect.bodyContains ?? []) {
      expect(body, `expected body to contain ${JSON.stringify(sub)}`).toContain(sub)
    }
    for (const sub of scenario.expect.bodyNotContains ?? []) {
      expect(body, `expected body NOT to contain ${JSON.stringify(sub)}`).not.toContain(sub)
    }
  })
})
