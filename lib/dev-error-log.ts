/**
 * In-memory front-end error log for the local Dev Log drawer.
 * Only used when NODE_ENV === "development" — never ships to production UI.
 */

export type DevLogKind = "error" | "unhandledrejection" | "resource" | "react" | "console"

export type DevLogEntry = {
  id: string
  at: number
  kind: DevLogKind
  message: string
  /** Best-effort "file.tsx:line:col" parsed from the stack. */
  source: string | null
  stack: string | null
  /** React component stack from an ErrorBoundary, when available. */
  componentStack: string | null
}

const MAX_ENTRIES = 80
const listeners = new Set<() => void>()
let entries: DevLogEntry[] = []

function notify(): void {
  for (const cb of listeners) {
    try {
      cb()
    } catch {
      // Never let a subscriber crash the logger.
    }
  }
}

/** Pull the first app source frame (components/, app/, lib/) from a stack string. */
export function parseStackLocation(stack: string | null | undefined): string | null {
  if (!stack) return null
  const lines = stack.split("\n")
  for (const line of lines) {
    // webpack-internal:///./components/foo.tsx:42:15
    const webpack = line.match(
      /(?:webpack-internal:\/\/\/\.\/|webpack:\/\/\/\.\/|\(app:\/\/\/)([^):]+\.(?:tsx?|jsx?)):(\d+):(\d+)/
    )
    if (webpack) {
      return `${webpack[1]}:${webpack[2]}:${webpack[3]}`
    }
    // (http://localhost:3000/_next/static/chunks/app/dashboard/page.js:12:34) — less useful
    // Prefer paths that look like repo files: .../components/foo.tsx:10:5
    const fileLine = line.match(/((?:components|app|lib|hooks)\/[^)\s:]+\.(?:tsx?|jsx?)):(\d+):(\d+)/)
    if (fileLine) {
      return `${fileLine[1]}:${fileLine[2]}:${fileLine[3]}`
    }
    // at ComponentName (file.tsx:12:3)
    const bare = line.match(/\(([^/\s()]+\.(?:tsx?|jsx?)):(\d+):(\d+)\)/)
    if (bare) {
      return `${bare[1]}:${bare[2]}:${bare[3]}`
    }
  }
  // Fallback: first frame with any .tsx/.ts path
  for (const line of lines) {
    const any = line.match(/([^\s()]+\.(?:tsx?|jsx?)):(\d+)(?::(\d+))?/)
    if (any) {
      const file = any[1].replace(/^.*\/(?=components\/|app\/|lib\/|hooks\/)/, "")
      return any[3] ? `${file}:${any[2]}:${any[3]}` : `${file}:${any[2]}`
    }
  }
  return null
}

/** First meaningful line from a React componentStack. */
export function parseComponentStackHint(componentStack: string | null | undefined): string | null {
  if (!componentStack) return null
  const line = componentStack
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("at ") && !l.includes("ErrorBoundary"))
  if (!line) return null
  // "at DashboardPage (components/dashboard-page.tsx:80:5)" or "at DashboardPage"
  const withFile = line.match(/at\s+(\S+)\s+\(([^)]+)\)/)
  if (withFile) {
    const loc = parseStackLocation(`at (${withFile[2]})`) || withFile[2]
    return `${withFile[1]} @ ${loc}`
  }
  const nameOnly = line.match(/at\s+(\S+)/)
  return nameOnly ? nameOnly[1] : line
}

export function pushDevErrorLog(
  partial: Omit<DevLogEntry, "id" | "at" | "source" | "stack" | "componentStack"> & {
    source?: string | null
    stack?: string | null
    componentStack?: string | null
    at?: number
  }
): DevLogEntry {
  const stack = partial.stack ?? null
  const componentStack = partial.componentStack ?? null
  const source =
    partial.source ??
    parseStackLocation(stack) ??
    (componentStack ? parseComponentStackHint(componentStack) : null)
  const entry: DevLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    at: partial.at ?? Date.now(),
    kind: partial.kind,
    message: String(partial.message || "Unknown error").slice(0, 2000),
    source,
    stack,
    componentStack,
  }
  entries = [entry, ...entries].slice(0, MAX_ENTRIES)
  notify()
  return entry
}

export function getDevErrorLogs(): readonly DevLogEntry[] {
  return entries
}

export function clearDevErrorLogs(): void {
  entries = []
  notify()
}

export function subscribeDevErrorLog(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function stackFromUnknown(error: unknown): string | null {
  if (error instanceof Error && error.stack) return error.stack
  return null
}
