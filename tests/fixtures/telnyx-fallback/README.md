# Telnyx Dial `action` fixtures

Use these to **replay** a real callback without guessing what Telnyx sends.

## Vercel: why you might see nothing

- **`telnyx-fallback-diagnostic` is only logged when Telnyx calls `/api/voice/telnyx/fallback/...`** (the Dial `action` after your cell ring ends). It is **not** logged for **`/api/voice/telnyx/incoming`** alone.
- In **Logs**, set the filter so **Request** contains **`fallback`** (or `telnyx/fallback`), then make a test call. If **no row** appears, Telnyx is not hitting your app for no-answer — check the TeXML `action` URL in Telnyx / `NEXT_PUBLIC_APP_URL`.
- Search **without** wrapping in quotes: `telnyx-fallback-diagnostic` (not `"telnyx-fallback-diagnostic"` — some UIs treat quotes as literal).
- After adding `ZING_TELNYX_FALLBACK_DIAGNOSTIC`, **redeploy** so the running build has the env var and the latest logging code.

With diagnostics on, you should see **`phase":"entry"`** as soon as `/fallback` runs, then **`phase":"full"`** after routing (or **`phase":"early-exit"`** if we hang up early).

## 1. Capture one failing call

1. In **Vercel** → your project → **Logs**, find the request to  
   `/api/voice/telnyx/fallback/...`
2. Turn on verbose diagnostics (optional but best): set env  
   **`ZING_TELNYX_FALLBACK_DIAGNOSTIC=true`**, redeploy, reproduce once.
3. Copy the JSON line where **`"zing":"telnyx-fallback-diagnostic"`** appears.  
   It includes **`formRedacted`** (safe to share) and **`snapshot`** (routing decisions).

## 2. Add a Vitest scenario

Edit **`tests/telnyx-fallback.handler.test.ts`** (or add a case to the `scenarios` array in **`scenarios.ts`**) with:

- **`url`** — same path/query as production (you can shorten host to `http://test.local`)
- **`form`** — use the **raw** field names/values from Telnyx (not redacted) in your local file only; **do not commit** real phone numbers — use fake E.164 like `+15551110001`.
- **`mocks`** — what `getUser` / `getIncomingRoutingByNumber` / etc. should return
- **`expect.bodyContains` / `bodyNotContains`** — substrings in the TeXML body

## 3. Run tests

```bash
cd /path/to/Lyncr
npm run test
```

This proves the handler still behaves the same for that payload after code changes.
