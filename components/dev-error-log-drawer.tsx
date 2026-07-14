"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { Bug, Copy, Trash2, X } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  clearDevErrorLogs,
  formatErrorMessage,
  getDevErrorLogs,
  parseStackLocation,
  pushDevErrorLog,
  stackFromUnknown,
  subscribeDevErrorLog,
  type DevLogEntry,
} from "@/lib/dev-error-log"

/** Subscribe to the in-memory log store (React 18 external store). */
function useDevErrorLogs(): readonly DevLogEntry[] {
  return useSyncExternalStore(subscribeDevErrorLog, getDevErrorLogs, () => [])
}

function kindLabel(kind: DevLogEntry["kind"]): string {
  switch (kind) {
    case "unhandledrejection":
      return "Promise"
    case "resource":
      return "Load fail"
    case "react":
      return "React"
    case "console":
      return "console.error"
    default:
      return "window.onerror"
  }
}

function kindColor(kind: DevLogEntry["kind"]): string {
  switch (kind) {
    case "react":
      return "bg-amber-500/20 text-amber-200 border-amber-500/40"
    case "resource":
      return "bg-sky-500/20 text-sky-200 border-sky-500/40"
    case "unhandledrejection":
      return "bg-violet-500/20 text-violet-200 border-violet-500/40"
    default:
      return "bg-rose-500/20 text-rose-200 border-rose-500/40"
  }
}

/**
 * Floating bubble + sliding panel that shows recent client errors.
 * Mounted only in development from the root layout.
 */
export function DevErrorLogDrawer() {
  const logs = useDevErrorLogs()
  const [open, setOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Install global listeners once — captures workspace switch / UI interaction failures.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return

    const onWindowError = (event: ErrorEvent) => {
      // Resource load failures (script/img/css) use event.target instead of error.
      const target = event.target
      if (target && target !== window && target instanceof HTMLElement) {
        const tag = target.tagName.toLowerCase()
        const src =
          (target as HTMLImageElement | HTMLScriptElement).src ||
          (target as HTMLLinkElement).href ||
          ""
        if (tag === "script" || tag === "link" || tag === "img") {
          pushDevErrorLog({
            kind: "resource",
            message: `Failed to load <${tag}> ${src || "(unknown url)"}`,
            source: src || null,
            stack: null,
          })
          return
        }
      }

      const stack = event.error instanceof Error ? event.error.stack ?? null : null
      const sourceFromEvent =
        event.filename && event.lineno
          ? `${event.filename.replace(/^.*\/(?=components\/|app\/|lib\/|hooks\/|_next\/)/, "")}:${event.lineno}:${event.colno || 0}`
          : null
      pushDevErrorLog({
        kind: "error",
        message: event.message || formatErrorMessage(event.error) || "Script error",
        source: sourceFromEvent || parseStackLocation(stack),
        stack,
      })
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const stack = stackFromUnknown(reason)
      pushDevErrorLog({
        kind: "unhandledrejection",
        message: formatErrorMessage(reason),
        source: parseStackLocation(stack),
        stack,
      })
    }

    // Mirror console.error so Next.js / library failures show up even without a throw.
    const originalConsoleError = console.error.bind(console)
    console.error = (...args: unknown[]) => {
      try {
        const first = args[0]
        const message = args
          .map((a) => {
            if (a instanceof Error) return a.message
            if (typeof a === "string") return a
            try {
              return JSON.stringify(a)
            } catch {
              return String(a)
            }
          })
          .join(" ")
          .slice(0, 2000)
        // Skip noisy Next.js HMR / React refresh chatter.
        if (
          !message.includes("[Fast Refresh]") &&
          !message.includes("Download the React DevTools")
        ) {
          const errArg = args.find((a) => a instanceof Error) as Error | undefined
          pushDevErrorLog({
            kind: "console",
            message: message || "console.error",
            stack: errArg?.stack ?? (typeof first === "string" ? first : null),
          })
        }
      } catch {
        // ignore logger failures
      }
      originalConsoleError(...args)
    }

    window.addEventListener("error", onWindowError, true)
    window.addEventListener("unhandledrejection", onUnhandledRejection)

    return () => {
      window.removeEventListener("error", onWindowError, true)
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
      console.error = originalConsoleError
    }
  }, [])

  const copyEntry = useCallback(async (entry: DevLogEntry) => {
    const text = [
      `[${kindLabel(entry.kind)}] ${new Date(entry.at).toISOString()}`,
      entry.message,
      entry.source ? `Source: ${entry.source}` : null,
      entry.componentStack ? `Component stack:\n${entry.componentStack}` : null,
      entry.stack ? `Stack:\n${entry.stack}` : null,
    ]
      .filter(Boolean)
      .join("\n\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(entry.id)
      window.setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // Clipboard may be blocked — ignore.
    }
  }, [])

  // Production builds never mount this component from layout, but guard anyway.
  if (process.env.NODE_ENV !== "development") return null

  const count = logs.length

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-4 right-4 z-[9998] flex h-12 w-12 items-center justify-center rounded-full border shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          count > 0
            ? "border-rose-500/60 bg-rose-950 text-rose-100"
            : "border-zinc-700 bg-zinc-900 text-zinc-300"
        )}
        aria-label={count > 0 ? `Open dev error log (${count})` : "Open dev error log"}
        title="Dev error log"
      >
        <Bug className="h-5 w-5" aria-hidden />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 border-zinc-800 bg-zinc-950 p-0 sm:max-w-md"
        >
          <SheetHeader className="shrink-0 border-b border-zinc-800 px-4 py-4 text-left">
            <SheetTitle className="flex items-center gap-2 text-foreground">
              <Bug className="h-4 w-4 text-rose-400" aria-hidden />
              Dev error log
            </SheetTitle>
            <SheetDescription className="text-zinc-400">
              Live window errors, failed loads, and unhandled promise rejections while you click around
              or switch workspaces. Development only.
            </SheetDescription>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-zinc-700"
                onClick={() => clearDevErrorLogs()}
                disabled={count === 0}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Clear
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-zinc-400"
                onClick={() => setOpen(false)}
              >
                <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Close
              </Button>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {count === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
                No client errors yet. Switch workspaces or click through the UI — failures will land
                here with file and line when available.
              </p>
            ) : (
              <ul className="space-y-3">
                {logs.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          kindColor(entry.kind)
                        )}
                      >
                        {kindLabel(entry.kind)}
                      </span>
                      <time className="shrink-0 text-[10px] tabular-nums text-zinc-500">
                        {new Date(entry.at).toLocaleTimeString()}
                      </time>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-100">
                      {entry.message}
                    </p>
                    {entry.source ? (
                      <p className="mt-2 rounded-md bg-zinc-950/80 px-2 py-1 font-mono text-[11px] leading-relaxed text-emerald-300/90">
                        {entry.source}
                      </p>
                    ) : (
                      <p className="mt-2 text-[11px] text-zinc-600">No file:line parsed from stack</p>
                    )}
                    {entry.componentStack ? (
                      <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
                        {entry.componentStack.trim()}
                      </pre>
                    ) : null}
                    {entry.stack ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300">
                          Stack trace
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-zinc-500">
                          {entry.stack}
                        </pre>
                      </details>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-2 h-7 px-2 text-xs text-zinc-400"
                      onClick={() => void copyEntry(entry)}
                    >
                      <Copy className="mr-1 h-3 w-3" aria-hidden />
                      {copiedId === entry.id ? "Copied" : "Copy"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
