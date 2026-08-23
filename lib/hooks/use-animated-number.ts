"use client"

import { useEffect, useState } from "react"
import { useMotionValue, useMotionValueEvent, useSpring } from "framer-motion"
import { useMotionPrefs } from "@/lib/motion"

const DEFAULT_FORMATTER = (n: number) => String(Math.round(n))

/**
 * Spring-rolls a displayed number toward `value` instead of hard-swapping the text — for
 * KPI pills fed by push (Pusher) or poll updates. Snaps instantly with no animation when
 * the viewer prefers reduced motion, matching the rest of the app's motion-safe branching
 * (see workspace-filter-pills.tsx).
 */
export function useAnimatedNumber(
  value: number,
  options?: {
    formatter?: (n: number) => string
    /** Softer (lower) for big jumps like currency, snappier (higher) for small counts. */
    stiffness?: number
    damping?: number
  }
): string {
  const { prefersReducedMotion } = useMotionPrefs()
  const format = options?.formatter ?? DEFAULT_FORMATTER
  const stiffness = options?.stiffness ?? 220
  const damping = options?.damping ?? 26

  const motionValue = useMotionValue(value)
  const spring = useSpring(motionValue, { stiffness, damping })
  const [display, setDisplay] = useState(() => format(value))

  useEffect(() => {
    motionValue.set(value)
  }, [value, motionValue])

  useMotionValueEvent(spring, "change", (latest) => {
    setDisplay(format(latest))
  })

  // Reduced motion — mirror the target value directly, skip the spring lag entirely.
  return prefersReducedMotion ? format(value) : display
}
