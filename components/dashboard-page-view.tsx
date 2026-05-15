"use client"

// ============================================
// Animated wrapper for each dashboard tab’s content
// ============================================
// `key={pathname}` restarts the enter animation on each segment change. prefers-reduced-motion
// disables the keyframes in `globals.css` (`.animate-sigo-page-enter`).

import { type ReactNode } from "react"

export function DashboardPageView({
  pathname,
  children,
}: {
  pathname: string
  children: ReactNode
}) {
  return (
    <div key={pathname} className="min-h-full bg-background animate-sigo-page-enter">
      {children}
    </div>
  )
}
