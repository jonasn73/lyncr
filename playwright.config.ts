// E2E config. Tests live in e2e/ (not tests/, which is vitest-only) and run against a real
// `next dev` server backed by an isolated Postgres database — never production. See
// e2e/global-setup.ts for how that database gets bootstrapped, and .env.test.local (gitignored,
// like .env.local) for the local-dev connection string.
//
// RESEND_API_KEY / TELNYX_API_KEY are deliberately never set for this server: every email/SMS
// send path in this codebase already fails soft (logs a warning, returns `{ sent: false }`)
// rather than throwing when they're missing, so signup/booking/password-reset flows complete
// normally for testing without contacting a real third party or spending money. Stripe is
// exempt from that concern (test-mode keys are inherently side-effect-free), but a real
// STRIPE_SECRET_KEY (sk_test_...) is required locally to exercise payment flows — see the repo
// .env.local comment; without one, deposit/checkout-touching tests are skipped, not run unsafely.

import { defineConfig, devices } from "@playwright/test"
import { readFileSync } from "fs"

const PORT = 3100
const BASE_URL = `http://localhost:${PORT}`

/** Same minimal .env.local-style loader run-schema.mjs and friends use — no dotenv dependency. */
function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
  } catch {
    // No .env.test.local — fine in CI, which sets these as real workflow env vars instead.
  }
  return out
}

// CI sets DATABASE_URL etc. directly (see .github/workflows/ci.yml's e2e job) and should win;
// .env.test.local only fills in what's not already in the environment, for local runs.
const fileEnv = loadEnvFile(".env.test.local")
const testEnv: Record<string, string> = { ...fileEnv, ...process.env as Record<string, string> }
for (const [key, value] of Object.entries(fileEnv)) {
  if (!process.env[key]) testEnv[key] = value
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // Shared database — parallel specs would step on each other's data.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: testEnv,
  },
})
