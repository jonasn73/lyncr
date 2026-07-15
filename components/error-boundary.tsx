"use client"

import React from "react"

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
}

// Error boundary (must be a class component) to catch client-side React errors
// and show a friendly message instead of "Application error"
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[lyncr] Client error:", error, info.componentStack)
    // Feed the local Dev Log drawer (development only — push is a no-op cost if unused).
    if (process.env.NODE_ENV === "development") {
      void import("@/lib/dev-error-log").then(({ pushDevErrorLog }) => {
        pushDevErrorLog({
          kind: "react",
          message: error.message || error.name || "React render error",
          stack: error.stack ?? null,
          componentStack: info.componentStack ?? null,
        })
      })
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6">
          <p className="text-center text-foreground">Something went wrong.</p>
          <a
            href="/"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Go to login
          </a>
        </div>
      )
    }
    return this.props.children
  }
}
