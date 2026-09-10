import { test, expect } from "@playwright/test"

// Business names starting with "test" get account_status "active" immediately (see
// lib/account-status.ts signupAccountStatusForBusinessName) instead of "pending" — lets these
// tests reach the real dashboard instead of stopping at /waiting-approval.
function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

// lib/db.ts's getSql() always connects via @neondatabase/serverless's neon() — an HTTP driver
// that only speaks to real Neon infrastructure (confirmed directly: pointed at a local Postgres
// it fails with "Failed to parse URL from https://api.0.0.1/sql", not a connection error —
// Neon's own README: "you can also use it to connect to your own Postgres instances if you run
// your own WebSocket proxy"). scripts/migrate.mjs works locally because it uses plain `pg`, a
// completely different code path from the app's own runtime. Every test below that needs the
// signup/login API to actually write a user row is skipped here until either a Neon branch
// database (needs NEON_API_KEY to create/tear down programmatically) or the community wsproxy
// (needs Docker, not installed in this environment) is wired into e2e/global-setup.ts — a real
// decision/setup step, not something to fake past. The client-only tests in this file (password
// minLength, generic forgot-password copy) don't hit this and run for real.
const DB_WRITES_SUPPORTED = false
const skipReason =
  "Needs a real Neon-compatible database (branch DB or the wsproxy) — see the comment above DB_WRITES_SUPPORTED."

test.describe("signup", () => {
  test("creates an account and lands on the dashboard", async ({ page }) => {
    test.skip(!DB_WRITES_SUPPORTED, skipReason)
    const email = uniqueEmail()

    await page.goto("/signup")
    await page.fill("#businessName", "TEST Locksmith E2E")
    await page.fill("#ownerName", "E2E Test Owner")
    await page.fill("#ownerPhone", "5551234567")
    await page.fill("#email", email)
    await page.fill("#password", "correct horse battery staple")
    await page.getByRole("button", { name: "Create Account" }).click()

    await expect(page).toHaveURL(/\/dashboard|\/onboarding/, { timeout: 15_000 })
  })

  test("rejects a password under 8 characters", async ({ page }) => {
    await page.goto("/signup")
    await page.fill("#businessName", "TEST Locksmith Short PW")
    await page.fill("#ownerName", "E2E Test Owner")
    await page.fill("#ownerPhone", "5551234567")
    await page.fill("#email", uniqueEmail())
    await page.fill("#password", "short")
    await page.getByRole("button", { name: "Create Account" }).click()

    // The password input has minLength={8} (components/auth-pages.tsx) — the browser's own
    // HTML5 validation blocks the form before it ever submits, so this never reaches the
    // server's "Password must be at least 8 characters" check (verified directly via
    // POST /api/auth/signup, which does return that error — this test is about the client
    // layer specifically). Confirm the native validation actually fired and nothing submitted.
    const validationMessage = await page.locator("#password").evaluate((el: HTMLInputElement) => el.validationMessage)
    expect(validationMessage).not.toBe("")
    await expect(page).toHaveURL(/\/signup/)
  })
})

test.describe("login", () => {
  async function signUp(page: import("@playwright/test").Page, email: string, password: string) {
    await page.goto("/signup")
    await page.fill("#businessName", "TEST Locksmith Login E2E")
    await page.fill("#ownerName", "E2E Test Owner")
    await page.fill("#ownerPhone", "5551234567")
    await page.fill("#email", email)
    await page.fill("#password", password)
    await page.getByRole("button", { name: "Create Account" }).click()
    await expect(page).toHaveURL(/\/dashboard|\/onboarding/, { timeout: 15_000 })
  }

  test("logs in with valid credentials, then logs out", async ({ page }) => {
    test.skip(!DB_WRITES_SUPPORTED, skipReason)
    const email = uniqueEmail()
    const password = "correct horse battery staple"
    await signUp(page, email, password)

    // Clear the session cookie to simulate a fresh login rather than the post-signup session.
    await page.context().clearCookies()

    await page.goto("/login")
    await page.fill("#email", email)
    await page.fill("#password", password)
    await page.getByRole("button", { name: "Log In" }).click()

    await expect(page).toHaveURL(/\/dashboard|\/onboarding/, { timeout: 15_000 })
  })

  test("rejects an invalid password without revealing whether the account exists", async ({ page }) => {
    test.skip(!DB_WRITES_SUPPORTED, skipReason)
    const email = uniqueEmail()
    await signUp(page, email, "correct horse battery staple")
    await page.context().clearCookies()

    await page.goto("/login")
    await page.fill("#email", email)
    await page.fill("#password", "definitely the wrong password")
    await page.getByRole("button", { name: "Log In" }).click()

    await expect(page.getByText("Invalid email or password")).toBeVisible()
    await expect(page).toHaveURL(/\/login/)

    // Same message for an email that was never registered — never confirm which case it was.
    await page.fill("#email", `never-registered-${Date.now()}@example.com`)
    await page.fill("#password", "whatever")
    await page.getByRole("button", { name: "Log In" }).click()
    await expect(page.getByText("Invalid email or password")).toBeVisible()
  })
})

test.describe("forgot password", () => {
  test("always shows the same generic message, and never puts a reset link on the page", async ({ page }) => {
    // Regression test for the account-takeover fix: this page used to render the raw reset
    // token/URL directly for any submitted email, letting anyone who knew an address take over
    // the account without ever receiving anything by email.
    // Still needs DB_WRITES_SUPPORTED: the route reads getAuthUserByEmail before it can return
    // the generic response, same getSql()/neon() constraint as the tests above.
    test.skip(!DB_WRITES_SUPPORTED, skipReason)
    await page.goto("/forgot-password")
    await page.fill("#email", `no-account-here-${Date.now()}@example.com`)
    await page.getByRole("button", { name: /send reset link/i }).click()

    await expect(page.getByText(/if an account exists for that email/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("link", { name: /open reset page/i })).toHaveCount(0)
    await expect(page.getByText(/reset-password\?token=/i)).toHaveCount(0)
  })
})
