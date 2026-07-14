import { describe, expect, it } from "vitest"
import { parseComponentStackHint, parseStackLocation } from "@/lib/dev-error-log"

describe("parseStackLocation", () => {
  it("extracts webpack-internal app paths", () => {
    const stack = `Error: boom
    at DashboardPage (webpack-internal:///./components/dashboard-page.tsx:152:11)
    at renderWithHooks`
    expect(parseStackLocation(stack)).toBe("components/dashboard-page.tsx:152:11")
  })

  it("extracts components/ paths from a browser stack", () => {
    const stack = `Error: fail
    at foo (http://localhost:3000/_next/static/chunks/main.js:1:1)
    at bar (components/dashboard-routing-sheets.tsx:88:4)`
    expect(parseStackLocation(stack)).toBe("components/dashboard-routing-sheets.tsx:88:4")
  })

  it("returns null for empty stacks", () => {
    expect(parseStackLocation(null)).toBeNull()
    expect(parseStackLocation("")).toBeNull()
  })
})

describe("parseComponentStackHint", () => {
  it("returns component name and file when present", () => {
    const stack = `
    at DashboardPage (components/dashboard-page.tsx:80:5)
    at Suspense`
    expect(parseComponentStackHint(stack)).toContain("DashboardPage")
    expect(parseComponentStackHint(stack)).toContain("dashboard-page.tsx")
  })
})
