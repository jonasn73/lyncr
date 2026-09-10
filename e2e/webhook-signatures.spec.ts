import { test, expect } from "@playwright/test"

// TELNYX_PUBLIC_KEY is intentionally unset in the E2E env (see playwright.config.ts) — so
// validateTelnyxRequest (lib/telnyx.ts) can never succeed here regardless of what's sent. That's
// exactly what these assert: every Telnyx webhook route fails closed (401), never open, on an
// unverifiable signature. (voice/telnyx/status and webhooks/telnyx/voice are excluded — both
// sit behind their own feature flags/routing that return 404 before the signature check in a
// plain local env, which would make a 401 assertion meaningless there.)
const WEBHOOK_ROUTES = ["/api/webhooks/telnyx/messaging", "/api/webhooks/telnyx/porting", "/api/messaging/webhook"]

for (const route of WEBHOOK_ROUTES) {
  test(`${route} rejects a request with no Telnyx signature headers`, async ({ request }) => {
    const res = await request.post(route, {
      data: { event_type: "message.received", payload: { text: "e2e probe — should be rejected" } },
    })
    expect(res.status()).toBe(401)
  })

  test(`${route} rejects a forged signature header`, async ({ request }) => {
    const res = await request.post(route, {
      data: { event_type: "message.received" },
      headers: {
        "telnyx-signature-ed25519": Buffer.from("not-a-real-signature").toString("base64"),
        "telnyx-timestamp": String(Math.floor(Date.now() / 1000)),
      },
    })
    expect(res.status()).toBe(401)
  })
}
