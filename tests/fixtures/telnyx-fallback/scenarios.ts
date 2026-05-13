/**
 * Declarative Telnyx Dial `action` scenarios for Vitest.
 * Add a row here when you capture a real callback (see README.md in this folder).
 */

import type { FallbackType, RoutingConfig, User } from "@/lib/types"

/** What mocked DB/lifecycle return for this request. */
export type TelnyxFallbackFixtureMocks = {
  incomingRouting: {
    user_id: string
    user_name: string
    business_name: string
    inbound_receptionist_whisper_enabled: boolean
    owner_phone: string
    selected_receptionist_id: string | null
    fallback_type: FallbackType
    ring_timeout_seconds: number
    ai_ring_owner_first: boolean
    receptionist_name: string | null
    receptionist_phone: string | null
    phone_line_label: string
    phone_line_friendly_name: string
  } | null
  routingForNumber: RoutingConfig | null
  globalRouting: RoutingConfig | null
  user: User | null
  primaryBusinessE164: string | null
  /** If set, overrides default ensureTelnyxVoiceAiAssistant resolution. */
  ensureAssistant?: { linked: boolean; assistantId?: string; error?: string }
}

export type TelnyxFallbackFixture = {
  id: string
  description: string
  method: "GET" | "POST"
  /** Full URL including path + query (host can be dummy). */
  url: string
  /** Simulated Telnyx form body (use fake numbers in committed fixtures). */
  form: Record<string, string>
  mocks: TelnyxFallbackFixtureMocks
  expect: {
    bodyContains?: string[]
    bodyNotContains?: string[]
    contentType?: string
  }
}

const baseUser = (over: Partial<User>): User => ({
  id: "11111111-1111-1111-1111-111111111111",
  email: "fixture@test.local",
  name: "Fixture User",
  phone: "+15551110002",
  business_name: "Fixture Biz",
  inbound_receptionist_whisper_enabled: true,
  industry: "other",
  telnyx_ai_assistant_id: "assistant-22222222-2222-4222-8222-222222222222",
  created_at: "2020-01-01T00:00:00.000Z",
  ...over,
})

const baseRouting = (over: Partial<RoutingConfig>): RoutingConfig => ({
  id: "rc-fixture",
  user_id: "11111111-1111-1111-1111-111111111111",
  business_number: "+15551110001",
  selected_receptionist_id: null,
  fallback_type: "ai",
  ai_greeting: "Hi",
  ring_timeout_seconds: 30,
  ai_ring_owner_first: false,
  updated_at: "2020-01-01T00:00:00.000Z",
  ...over,
})

const baseIncomingRouting = (
  over: Partial<NonNullable<TelnyxFallbackFixtureMocks["incomingRouting"]>>
): NonNullable<TelnyxFallbackFixtureMocks["incomingRouting"]> => ({
  user_id: "11111111-1111-1111-1111-111111111111",
  user_name: "Fixture User",
  business_name: "Fixture Biz",
  inbound_receptionist_whisper_enabled: true,
  owner_phone: "+15551110002",
  selected_receptionist_id: null,
  fallback_type: "ai",
  ring_timeout_seconds: 22,
  ai_ring_owner_first: true,
  receptionist_name: null,
  receptionist_phone: null,
  phone_line_label: "Main Line",
  phone_line_friendly_name: "(555) 111-0001",
  ...over,
})

export const telnyxFallbackScenarios: TelnyxFallbackFixture[] = [
  {
    id: "owner-leg-no-answer-owner-ai-path",
    description: "Owner ring ended with no-answer; path mode owner-ai; assistant linked → Say + Redirect to ai-bridge",
    method: "POST",
    url: "http://test.local/api/voice/telnyx/fallback/u/11111111-1111-1111-1111-111111111111/n/15551110001/owner-ai?callSid=CA_fixture_no_answer",
    form: {
      DialCallStatus: "no-answer",
      CallSid: "CA_fixture_no_answer",
      To: "+15551110002",
    },
    mocks: {
      incomingRouting: baseIncomingRouting({}),
      routingForNumber: baseRouting({ fallback_type: "ai", business_number: "+15551110001" }),
      globalRouting: baseRouting({
        business_number: null,
        fallback_type: "voicemail",
        id: "rc-global",
      }),
      user: baseUser({}),
      primaryBusinessE164: "+15551110001",
    },
    expect: {
      bodyContains: ["Thanks for calling", "ai-bridge"],
      bodyNotContains: ["<Record"],
      contentType: "text/xml",
    },
  },
  {
    id: "completed-long-duration-no-bridge-still-ai",
    description: "Telnyx sometimes sends completed + large DialCallDuration without DialBridgedTo (reject) — must not early-hangup; still hand off to AI",
    method: "POST",
    url: "http://test.local/api/voice/telnyx/fallback/u/11111111-1111-1111-1111-111111111111/n/15551110001/owner-ai?callSid=CA_fixture_completed",
    form: {
      DialCallStatus: "completed",
      DialCallDuration: "150",
      CallSid: "CA_fixture_completed",
      To: "+15551110002",
    },
    mocks: {
      incomingRouting: baseIncomingRouting({}),
      routingForNumber: baseRouting({ fallback_type: "ai" }),
      globalRouting: baseRouting({ business_number: null, fallback_type: "voicemail", id: "rc-g2" }),
      user: baseUser({}),
      primaryBusinessE164: "+15551110001",
    },
    expect: {
      bodyContains: ["ai-bridge"],
      bodyNotContains: ["</Hangup>"],
      contentType: "text/xml",
    },
  },
  {
    id: "owner-ai-long-bridged-owner-hangup-ends-caller",
    description:
      "Owner-first AI path: after a real PSTN bridge and completed leg, hang up the caller (no Voice AI handoff)",
    method: "POST",
    url: "http://test.local/api/voice/telnyx/fallback/u/11111111-1111-1111-1111-111111111111/n/15551110001/owner-ai?callSid=CA_fixture_long&primary=owner&leg=owner-first",
    form: {
      DialCallStatus: "completed",
      DialCallDuration: "130",
      DialBridgedTo: "+15559998877",
      CallSid: "CA_fixture_long",
      To: "+15551110002",
    },
    mocks: {
      incomingRouting: baseIncomingRouting({}),
      routingForNumber: baseRouting({ fallback_type: "ai" }),
      globalRouting: baseRouting({ business_number: null, fallback_type: "ai", id: "rc-g3" }),
      user: baseUser({}),
      primaryBusinessE164: "+15551110001",
    },
    expect: {
      bodyContains: ["Hangup"],
      bodyNotContains: ["ai-bridge", "Thanks for calling"],
      contentType: "text/xml",
    },
  },
  {
    id: "owner-ai-short-bridged-owner-hangup-ends-caller",
    description: "Owner-first AI path: short bridged completed leg still ends caller (no AI after you hang up)",
    method: "POST",
    url: "http://test.local/api/voice/telnyx/fallback/u/11111111-1111-1111-1111-111111111111/n/15551110001/owner-ai?callSid=CA_fixture_owner_short&primary=owner",
    form: {
      DialCallStatus: "completed",
      DialCallDuration: "18",
      DialBridgedTo: "+15551110002",
      CallSid: "CA_fixture_owner_short",
      To: "+15551110002",
    },
    mocks: {
      incomingRouting: baseIncomingRouting({}),
      routingForNumber: baseRouting({ fallback_type: "ai" }),
      globalRouting: baseRouting({ business_number: null, fallback_type: "ai", id: "rc-g7" }),
      user: baseUser({}),
      primaryBusinessE164: "+15551110001",
    },
    expect: {
      bodyContains: ["Hangup"],
      bodyNotContains: ["ai-bridge"],
      contentType: "text/xml",
    },
  },
  {
    id: "owner-path-voicemail-bridged-owner-hangup",
    description:
      "Voicemail fallback uses TeXML path owner: after answered owner leg, hang up caller (no AI/VM on their leg)",
    method: "POST",
    url: "http://test.local/api/voice/telnyx/fallback/u/11111111-1111-1111-1111-111111111111/n/15551110001/owner?callSid=CA_fixture_vm_owner&primary=owner&leg=owner-first",
    form: {
      DialCallStatus: "completed",
      DialCallDuration: "42",
      DialBridgedTo: "+15551110002",
      CallSid: "CA_fixture_vm_owner",
      To: "+15551110002",
    },
    mocks: {
      incomingRouting: baseIncomingRouting({ fallback_type: "voicemail", ai_ring_owner_first: false }),
      routingForNumber: baseRouting({ fallback_type: "voicemail" }),
      globalRouting: baseRouting({ business_number: null, fallback_type: "voicemail", id: "rc-vm" }),
      user: baseUser({}),
      primaryBusinessE164: "+15551110001",
    },
    expect: {
      bodyContains: ["Hangup"],
      bodyNotContains: ["ai-bridge", "Thanks for calling", "<Record"],
      contentType: "text/xml",
    },
  },
  {
    id: "owner-stripped-path-bridged-hangup",
    description:
      "Telnyx truncated /n/{did}/{mode} — still hang up after answered owner leg (no AI when path mode is unknown)",
    method: "POST",
    url: "http://test.local/api/voice/telnyx/fallback/u/11111111-1111-1111-1111-111111111111?callSid=CA_fixture_strip&primary=owner&leg=owner-first&bn=%2B15551110001",
    form: {
      DialCallStatus: "completed",
      DialCallDuration: "30",
      DialBridgedTo: "+15551110002",
      CallSid: "CA_fixture_strip",
      To: "+15551110002",
    },
    mocks: {
      incomingRouting: baseIncomingRouting({ fallback_type: "voicemail", ai_ring_owner_first: false }),
      routingForNumber: baseRouting({ fallback_type: "voicemail" }),
      globalRouting: baseRouting({ business_number: null, fallback_type: "voicemail", id: "rc-strip" }),
      user: baseUser({}),
      primaryBusinessE164: "+15551110001",
    },
    expect: {
      bodyContains: ["Hangup"],
      bodyNotContains: ["ai-bridge"],
      contentType: "text/xml",
    },
  },
  {
    id: "owner-bridged-duration-no-dial-bridged-to",
    description: "Telnyx sends DialBridgedDuration but omits DialBridgedTo — still hang up after owner answered",
    method: "POST",
    url: "http://test.local/api/voice/telnyx/fallback/u/11111111-1111-1111-1111-111111111111/n/15551110001/owner?callSid=CA_fixture_bridgedur&primary=owner",
    form: {
      DialCallStatus: "completed",
      DialCallDuration: "45",
      DialBridgedDuration: "38",
      CallSid: "CA_fixture_bridgedur",
      To: "+15551110002",
    },
    mocks: {
      incomingRouting: baseIncomingRouting({ fallback_type: "ai", ai_ring_owner_first: false }),
      routingForNumber: baseRouting({ fallback_type: "ai" }),
      globalRouting: baseRouting({ business_number: null, fallback_type: "ai", id: "rc-bd" }),
      user: baseUser({}),
      primaryBusinessE164: "+15551110001",
    },
    expect: {
      bodyContains: ["Hangup"],
      bodyNotContains: ["ai-bridge"],
      contentType: "text/xml",
    },
  },
  {
    id: "recv-ai-long-bridged-early-hangup",
    description: "Receptionist-first AI: 2+ min bridged recv leg → hang up caller (no AI after long desk call)",
    method: "POST",
    url: "http://test.local/api/voice/telnyx/fallback/u/11111111-1111-1111-1111-111111111111/n/15551110001/recv-ai?callSid=CA_fixture_recv_long",
    form: {
      DialCallStatus: "completed",
      DialCallDuration: "130",
      DialBridgedTo: "+15558887766",
      CallSid: "CA_fixture_recv_long",
      To: "+15558887766",
    },
    mocks: {
      incomingRouting: baseIncomingRouting({
        selected_receptionist_id: "recv-1",
        ai_ring_owner_first: false,
        receptionist_name: "Desk",
        receptionist_phone: "+15558887766",
      }),
      routingForNumber: baseRouting({ fallback_type: "ai", selected_receptionist_id: "recv-1" }),
      globalRouting: baseRouting({ business_number: null, fallback_type: "ai", id: "rc-g5" }),
      user: baseUser({}),
      primaryBusinessE164: "+15551110001",
    },
    expect: {
      bodyContains: ["Hangup"],
      bodyNotContains: ["ai-bridge"],
      contentType: "text/xml",
    },
  },
  {
    id: "recv-ai-short-bridged-early-hangup",
    description:
      "Receptionist-first AI: answered then hung up after a short bridge — hang up caller (no AI hold message)",
    method: "POST",
    url: "http://test.local/api/voice/telnyx/fallback/u/11111111-1111-1111-1111-111111111111/n/15551110001/recv-ai?callSid=CA_fixture_recv_short",
    form: {
      DialCallStatus: "completed",
      DialCallDuration: "25",
      DialBridgedTo: "+15558887766",
      CallSid: "CA_fixture_recv_short",
      To: "+15558887766",
    },
    mocks: {
      incomingRouting: baseIncomingRouting({
        selected_receptionist_id: "recv-1",
        ai_ring_owner_first: false,
        receptionist_name: "Desk",
        receptionist_phone: "+15558887766",
      }),
      routingForNumber: baseRouting({ fallback_type: "ai", selected_receptionist_id: "recv-1" }),
      globalRouting: baseRouting({ business_number: null, fallback_type: "ai", id: "rc-g6" }),
      user: baseUser({}),
      primaryBusinessE164: "+15551110001",
    },
    expect: {
      bodyContains: ["Hangup"],
      bodyNotContains: ["Thanks for calling", "ai-bridge"],
      contentType: "text/xml",
    },
  },
  {
    id: "no-assistant-ai-unavailable-voicemail",
    description: "AI path but no assistant id and ensure fails → Record / AI-unavailable copy",
    method: "POST",
    url: "http://test.local/api/voice/telnyx/fallback/u/11111111-1111-1111-1111-111111111111/n/15551110001/owner-ai?callSid=CA_fixture_no_asst",
    form: {
      DialCallStatus: "no-answer",
      CallSid: "CA_fixture_no_asst",
      To: "+15551110002",
    },
    mocks: {
      incomingRouting: baseIncomingRouting({}),
      routingForNumber: baseRouting({ fallback_type: "ai" }),
      globalRouting: baseRouting({ business_number: null, fallback_type: "ai", id: "rc-g4" }),
      user: baseUser({ telnyx_ai_assistant_id: null }),
      primaryBusinessE164: "+15551110001",
      ensureAssistant: { linked: false },
    },
    expect: {
      bodyContains: ["not set up", "Record"],
      bodyNotContains: ["ai-bridge"],
      contentType: "text/xml",
    },
  },
]
