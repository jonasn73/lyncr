"use client"

import React from "react"
import { writeClientCrashDump } from "@/lib/client-crash-dump"

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  message: string | null
  componentStack: string | null
  stack: string | null
}

/** Catches client React crashes and shows enough detail to fix production #185 loops. */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: null, componentStack: null, stack: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      message: error?.message || error?.name || "React render error",
      stack: error?.stack ?? null,
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const message = error.message || error.name || "React render error"
    // React 19 may also expose ownerStack on ErrorInfo — capture if present.
    const ownerStack =
      typeof (info as { ownerStack?: string }).ownerStack === "string"
        ? (info as { ownerStack?: string }).ownerStack ?? null
        : null
    const componentStack = [info.componentStack, ownerStack].filter(Boolean).join("\n") || null
    const stack = error.stack ?? null
    console.error("[lyncr] Client error:", error, componentStack, stack)
    this.setState({ message, componentStack, stack })
    writeClientCrashDump({
      at: Date.now(),
      message,
      stack,
      componentStack,
    })
    if (process.env.NODE_ENV === "development") {
      void import("@/lib/dev-error-log").then(({ pushDevErrorLog }) => {
        pushDevErrorLog({
          kind: "react",
          message,
          stack,
          componentStack,
        })
      })
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      // Prefer component tree; fall back to JS stack (minified builds often lack the former).
      const dumpText = this.state.componentStack || this.state.stack
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6">
          <p className="text-center text-foreground">Something went wrong.</p>
          {this.state.message ? (
            <p className="max-w-md text-center text-xs text-muted-foreground">{this.state.message}</p>
          ) : null}
          {dumpText ? (
            <pre className="max-h-56 max-w-lg overflow-auto rounded-lg border border-border bg-card p-3 text-left text-[10px] leading-snug text-muted-foreground whitespace-pre-wrap">
              {dumpText}
            </pre>
          ) : null}
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                this.setState({
                  hasError: false,
                  message: null,
                  componentStack: null,
                  stack: null,
                })
                window.location.reload()
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Try again
            </button>
            <a
              href="/"
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Go to login
            </a>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
