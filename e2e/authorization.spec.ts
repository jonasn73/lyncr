import { test, expect } from "@playwright/test"

// Every protected area must redirect an unauthenticated visitor away, never render. proxy.ts
// (Next middleware) catches every one of these uniformly and sends a request with no session
// cookie at all to /login?next=<path> — the more specific /tech/login redirect in
// app/tech/dashboard/layout.tsx only fires for an already-authenticated session with the wrong
// role, a layer deeper than what these tests exercise. A regression here (e.g. a path dropped
// from proxy.ts's needsSession check) would otherwise expose real business/customer data.
const PROTECTED_ROUTES: { path: string; redirectPattern: RegExp }[] = [
  { path: "/dashboard", redirectPattern: /\/login/ },
  { path: "/dashboard/customers", redirectPattern: /\/login/ },
  { path: "/dashboard/pay", redirectPattern: /\/login/ },
  { path: "/admin", redirectPattern: /\/login/ },
  { path: "/admin/audit", redirectPattern: /\/login/ },
  { path: "/admin/infra", redirectPattern: /\/login/ },
  { path: "/receptionist", redirectPattern: /\/login/ },
  { path: "/tech/dashboard", redirectPattern: /\/login/ },
]

for (const { path, redirectPattern } of PROTECTED_ROUTES) {
  test(`unauthenticated visitor to ${path} is redirected away, never sees the page`, async ({ page }) => {
    await page.context().clearCookies()
    await page.goto(path)
    await expect(page).toHaveURL(redirectPattern, { timeout: 10_000 })
  })
}

test("an invalid/expired session cookie is treated as logged out, not a crash", async ({ page }) => {
  await page.context().clearCookies()
  await page.context().addCookies([
    {
      name: "lyncr_session",
      value: "not-a-real-signed-session-value",
      domain: "localhost",
      path: "/",
    },
  ])
  await page.goto("/dashboard")
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
})
