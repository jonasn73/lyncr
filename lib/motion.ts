"use client"

// Shared motion constants — every framer-motion usage across the app re-declared its own
// duration/easing/spring values ad hoc (CallAnsweredModal.tsx, workspace-filter-pills.tsx,
// scheduler-job-slide-sheet.tsx, ...). Centralizing here so new work reuses the same feel
// instead of a fourth slightly-different one.

import { useReducedMotion } from "framer-motion"

/** Quick UI feedback — status/label swaps, fades. Matches CallAnsweredModal's step transitions. */
export const MOTION_FAST = { duration: 0.18 }

/** Slightly slower fade for content that needs a beat to register (skeleton→content). */
export const MOTION_SOFT = { duration: 0.22 }

/** Spring used for the shared sliding-pill indicator (workspace-filter-pills.tsx, command-dock.tsx). */
export const MOTION_SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.55 } as const

/** Softer spring for layout reflow (list reordering, row height changes). */
export const MOTION_SPRING_LAYOUT = { type: "spring", stiffness: 320, damping: 32 } as const

/** Standard easing for x/y slide-ins. */
export const MOTION_EASE_OUT = [0.22, 1, 0.36, 1] as const

/**
 * One place to check prefers-reduced-motion. Existing usages check useReducedMotion()
 * directly and branch to a static element when true (see workspace-filter-pills.tsx) — this
 * just gives every new consumer the same check under one name so it's never skipped.
 */
export function useMotionPrefs(): { prefersReducedMotion: boolean } {
  const prefersReducedMotion = useReducedMotion()
  return { prefersReducedMotion: Boolean(prefersReducedMotion) }
}
