"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useMotionPrefs } from "@/lib/motion"
import { cn } from "@/lib/utils"

const CROSSFADE_TRANSITION = { duration: 0.18 }

/**
 * Crossfades its text when `value` changes instead of a hard swap — every status label in the
 * app (Busy/Available, On/Off, Missed/Answered) did a plain ternary/prop swap with zero
 * transition. Caller keeps its own wrapping element (dd/span/etc) and className/tone logic;
 * this only wraps the text node itself, so color transitions along with the label.
 */
export function AnimatedStatusLabel({
  value,
  className,
}: {
  /** Also doubles as the AnimatePresence key — identity change triggers the crossfade. */
  value: string
  className?: string
}) {
  const { prefersReducedMotion } = useMotionPrefs()

  if (prefersReducedMotion) {
    return <span className={cn("inline-block", className)}>{value}</span>
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={value}
        initial={{ opacity: 0, y: -3 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 3 }}
        transition={CROSSFADE_TRANSITION}
        className={cn("inline-block", className)}
      >
        {value}
      </motion.span>
    </AnimatePresence>
  )
}
