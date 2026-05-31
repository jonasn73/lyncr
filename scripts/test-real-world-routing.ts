/**
 * Real-world routing stress-test simulator.
 *
 * Fires realistic Telnyx voice webhooks at your LOCAL voice handlers and reports
 * latency + status codes, so you can confirm nothing returns a 500 / server panic.
 *
 * It is a black-box HTTP tester: it talks to a running server over the network and
 * does NOT import app internals, so it exercises the real request path end-to-end.
 *
 * ── How to run ────────────────────────────────────────────────────────────────
 *   1. In one terminal, start the app:        npm run dev
 *   2. In a second terminal, run this script:  npx tsx scripts/test-real-world-routing.ts
 *
 *   Optional: point it at a different server (defaults to http://localhost:3000):
 *     npx tsx scripts/test-real-world-routing.ts http://localhost:3000
 *   or:
 *     TARGET_URL=https://staging.example.com npx tsx scripts/test-real-world-routing.ts
 * ────────────────────────────────────────────────────────────────────────────────
 */

// Base URL of the server under test. Priority: CLI arg → TARGET_URL env → localhost.
const BASE_URL = (process.argv[2] || process.env.TARGET_URL || "http://localhost:3000").replace(/\/$/, "")

// Voice webhook endpoints we will hammer (the real production routes).
const INCOMING_PATH = "/api/voice/telnyx/incoming" // TeXML handler: routes a new inbound call.
const STATUS_PATH = "/api/voice/telnyx/status" // Status callback: receives call lifecycle updates (e.g. hangup).
const WARM_PATH = "/api/voice/warm" // Lightweight health check that also warms the DB pool.

// Number of concurrent requests for the multi-tenant volume-spike scenario.
const SPIKE_COUNT = 20

// ── Types ───────────────────────────────────────────────────────────────────────

// The outcome of a single HTTP request, used for the final report.
type RequestResult = {
  scenario: string // Which scenario this request belonged to.
  label: string // Human-readable label for this specific request.
  status: number // HTTP status code (0 = the request never reached the server).
  ms: number // Round-trip latency in milliseconds.
  ok: boolean // True when status is a non-5xx, non-error response.
  note?: string // Optional extra detail (error message or body snippet).
}

// ── Payload builders ──────────────────────────────────────────────────────────

// Make a unique-ish Telnyx call_control_id (base64-ish opaque string, like the real ones).
function makeCallControlId(): string {
  // Random hex keeps each simulated call distinct so the server treats them as separate sessions.
  const rand = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  return `v3:stress-${rand}`
}

// Build a realistic Telnyx inbound call webhook (native JSON shape: { data: { payload: {...} } }).
function makeInboundPayload(opts: {
  to: string // The business number being called (the tenant's line).
  from: string // The caller's number.
  callControlId: string // Stable id for this call across its lifecycle events.
  eventType?: string // Telnyx event type, e.g. "call.initiated" or "call.hangup".
  state?: string // Call state, e.g. "ringing" or "hangup".
}) {
  const { to, from, callControlId, eventType = "call.initiated", state = "ringing" } = opts
  return {
    data: {
      event_type: eventType, // Telnyx event name.
      id: makeCallControlId(), // Event id (separate from the call id).
      occurred_at: new Date().toISOString(), // When the event happened.
      record_type: "event",
      payload: {
        call_control_id: callControlId, // Same id reused across the call's events.
        call_leg_id: `leg-${callControlId.slice(-12)}`, // One leg of the call.
        call_session_id: `sess-${callControlId.slice(-12)}`, // The overall call session.
        connection_id: "stress-connection-id", // The Telnyx connection/app id.
        direction: "inbound", // This is an incoming call to the business.
        state, // "ringing" while connecting; "hangup" when the caller drops.
        status: state, // Mirror of state, since some handlers read "status".
        from, // Caller's number.
        to, // Business number dialed.
        caller_id_name: "Stress Tester", // Optional caller name.
        start_time: new Date().toISOString(),
      },
    },
  }
}

// Build the form-encoded body Telnyx sends to a TeXML status callback (e.g. on hangup).
function makeStatusForm(opts: { callControlId: string; callStatus: string; duration?: number }): string {
  // URLSearchParams produces the application/x-www-form-urlencoded body the status route parses.
  const params = new URLSearchParams()
  params.set("CallControlId", opts.callControlId) // The call this status update is about.
  params.set("call_control_id", opts.callControlId) // Lowercase variant the route also accepts.
  params.set("CallStatus", opts.callStatus) // e.g. "completed", "no-answer", "canceled".
  params.set("CallDuration", String(opts.duration ?? 0)) // How long the call lasted, in seconds.
  params.set("Direction", "inbound") // Direction of the call.
  params.set("Timestamp", new Date().toISOString()) // When the event fired.
  return params.toString()
}

// ── HTTP helpers ────────────────────────────────────────────────────────────────

// Send one request, measure how long it took, and normalize the outcome into a RequestResult.
async function timedRequest(
  scenario: string,
  label: string,
  path: string,
  init: RequestInit
): Promise<RequestResult> {
  const start = Date.now() // Stopwatch start.
  try {
    const res = await fetch(`${BASE_URL}${path}`, init) // Actually send the request.
    const ms = Date.now() - start // Latency = now minus start.
    // Read (and discard most of) the body so the connection closes cleanly; keep a short snippet.
    const text = await res.text().catch(() => "")
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 80) // First 80 chars, whitespace-collapsed.
    return {
      scenario,
      label,
      status: res.status,
      ms,
      ok: res.status < 500, // A 5xx means an unhandled server error — that's what we're hunting for.
      note: res.status >= 400 ? snippet : undefined, // Show the body only when something looks off.
    }
  } catch (err) {
    // A thrown error here means the request never completed (server down, connection reset, etc.).
    const ms = Date.now() - start
    return {
      scenario,
      label,
      status: 0, // 0 is our sentinel for "no HTTP response at all".
      ms,
      ok: false,
      note: err instanceof Error ? err.message : String(err),
    }
  }
}

// Convenience: POST a JSON body (Telnyx native webhook shape).
function postJson(scenario: string, label: string, path: string, body: unknown): Promise<RequestResult> {
  return timedRequest(scenario, label, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Convenience: POST a form-encoded body (Telnyx TeXML status callback shape).
function postForm(scenario: string, label: string, path: string, formBody: string): Promise<RequestResult> {
  return timedRequest(scenario, label, path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
  })
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

// (a) A normal, healthy routing lifecycle: ringing → status update for a single call.
async function scenarioHealthyLifecycle(): Promise<RequestResult[]> {
  const scenario = "A. Healthy lifecycle"
  const callControlId = makeCallControlId() // One call id reused across its events.
  const results: RequestResult[] = []

  // 1) Inbound call rings in — server should return routing TeXML (status 200, XML body).
  results.push(
    await postJson(
      scenario,
      "inbound ringing → TeXML",
      INCOMING_PATH,
      makeInboundPayload({
        to: "+15025550100", // Business line being called.
        from: "+15025559001", // Caller.
        callControlId,
        eventType: "call.initiated",
        state: "ringing",
      })
    )
  )

  // 2) The call completes normally — status callback logs the final state.
  results.push(
    await postForm(
      scenario,
      "status completed",
      STATUS_PATH,
      makeStatusForm({ callControlId, callStatus: "completed", duration: 42 })
    )
  )

  return results
}

// (b) Caller hangs up mid-lookup: a "call.hangup" event arrives while routing is still resolving.
async function scenarioHangupMidLookup(): Promise<RequestResult[]> {
  const scenario = "B. Hang-up mid-lookup"
  const callControlId = makeCallControlId()
  const results: RequestResult[] = []

  // 1) Fire the inbound ring and the hangup back-to-back WITHOUT awaiting the first, so the
  //    hangup can land while the incoming handler is still doing its DB lookup. This is the race
  //    we want to prove is handled cleanly (no 500, no unhandled rejection).
  const ringing = postJson(
    scenario,
    "inbound ringing (not awaited)",
    INCOMING_PATH,
    makeInboundPayload({
      to: "+15025550101",
      from: "+15025559002",
      callControlId,
      eventType: "call.initiated",
      state: "ringing",
    })
  )

  // 2) Immediately send the hangup webhook for the same call id.
  const hangup = postJson(
    scenario,
    "call.hangup event",
    INCOMING_PATH,
    makeInboundPayload({
      to: "+15025550101",
      from: "+15025559002",
      callControlId,
      eventType: "call.hangup",
      state: "hangup",
    })
  )

  // 3) And the matching status callback that Telnyx would send on a caller-initiated drop.
  const status = postForm(
    scenario,
    "status canceled",
    STATUS_PATH,
    makeStatusForm({ callControlId, callStatus: "canceled", duration: 0 })
  )

  // Wait for all three to settle and collect their outcomes.
  results.push(...(await Promise.all([ringing, hangup, status])))
  return results
}

// (c) Multi-tenant volume spike: many different customer numbers calling at the exact same time.
async function scenarioVolumeSpike(): Promise<RequestResult[]> {
  const scenario = `C. Volume spike (${SPIKE_COUNT} concurrent)`

  // Build SPIKE_COUNT requests, each for a DIFFERENT business number + caller, then fire them all at once.
  const requests = Array.from({ length: SPIKE_COUNT }, (_, i) => {
    // Pad the index so each tenant gets a distinct, realistic-looking E.164 number.
    const suffix = String(i).padStart(4, "0")
    return postJson(
      scenario,
      `tenant +1502555${suffix}`,
      INCOMING_PATH,
      makeInboundPayload({
        to: `+1502555${suffix}`, // Unique business line per request.
        from: `+1606555${suffix}`, // Unique caller per request.
        callControlId: makeCallControlId(),
        eventType: "call.initiated",
        state: "ringing",
      })
    )
  })

  // Promise.all fires them concurrently — this is the real test of DB connection-pool resilience.
  return Promise.all(requests)
}

// ── Reporting ─────────────────────────────────────────────────────────────────

// Print a per-request line and a grouped summary, then return whether the whole run passed.
function report(all: RequestResult[]): boolean {
  console.log("\n──────────────────────────────────────────────────────────────")
  console.log(` Target: ${BASE_URL}`)
  console.log("──────────────────────────────────────────────────────────────")

  // Group results by scenario so the output reads top-to-bottom like the matrix above.
  const scenarios = Array.from(new Set(all.map((r) => r.scenario)))

  for (const scenario of scenarios) {
    console.log(`\n${scenario}`)
    const rows = all.filter((r) => r.scenario === scenario)
    for (const r of rows) {
      // ✅ for healthy, ❌ for a 5xx / failed request, so problems jump out instantly.
      const icon = r.ok ? "✅" : "❌"
      const statusText = r.status === 0 ? "NO RESPONSE" : String(r.status)
      const note = r.note ? `  ↳ ${r.note}` : ""
      console.log(`  ${icon} [${statusText}] ${String(r.ms).padStart(5)}ms  ${r.label}${note}`)
    }
  }

  // Aggregate stats across every request in the run.
  const latencies = all.map((r) => r.ms)
  const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0
  const max = latencies.length ? Math.max(...latencies) : 0
  const min = latencies.length ? Math.min(...latencies) : 0

  // The two failure conditions we explicitly care about: 5xx panics and dead connections.
  const serverErrors = all.filter((r) => r.status >= 500)
  const noResponse = all.filter((r) => r.status === 0)
  const failed = serverErrors.length + noResponse.length

  console.log("\n──────────────────────────────────────────────────────────────")
  console.log(" Summary")
  console.log("──────────────────────────────────────────────────────────────")
  console.log(`  Total requests : ${all.length}`)
  console.log(`  Latency        : min ${min}ms · avg ${avg}ms · max ${max}ms`)
  console.log(`  5xx server errs: ${serverErrors.length}`)
  console.log(`  No-response    : ${noResponse.length}`)

  if (failed === 0) {
    console.log("\n✅ PASS — no 500s and no unhandled server panics across any scenario.\n")
    return true
  }

  console.log(`\n❌ FAIL — ${failed} request(s) hit a server error or never responded.\n`)
  return false
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚦 Real-world routing stress test → ${BASE_URL}`)

  // Preflight: make sure the server is actually up before we run the matrix. Saves confusing output.
  const health = await timedRequest("preflight", "GET /api/voice/warm", WARM_PATH, { method: "GET" })
  if (health.status === 0) {
    console.error(
      `\n❌ Could not reach ${BASE_URL}${WARM_PATH}.\n` +
        `   Is the server running? Start it with:  npm run dev\n` +
        `   (or pass a different URL: npx tsx scripts/test-real-world-routing.ts <url>)\n`
    )
    process.exit(1) // Non-zero exit so CI/automation knows the run did not happen.
  }
  console.log(`   Server is up (warm check: ${health.status} in ${health.ms}ms)\n`)

  // Run the matrix. A and B are sequential (they model one call each); C is a concurrent burst.
  const all: RequestResult[] = []
  all.push(...(await scenarioHealthyLifecycle()))
  all.push(...(await scenarioHangupMidLookup()))
  all.push(...(await scenarioVolumeSpike()))

  // Print the report and exit non-zero if anything failed, so this is CI-friendly.
  const passed = report(all)
  process.exit(passed ? 0 : 1)
}

// Kick everything off and make sure any unexpected top-level error still exits non-zero.
main().catch((err) => {
  console.error("\n❌ Stress test crashed unexpectedly:", err)
  process.exit(1)
})
