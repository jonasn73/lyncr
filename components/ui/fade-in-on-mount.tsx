"use client"

import { motion } from "framer-motion"
import { MOTION_SOFT, useMotionPrefs } from "@/lib/motion"

/**
 * Eases resolved content in on mount instead of a hard pop when it replaces a Suspense
 * fallback. True crossfade of the fallback against real content isn't practical without
 * restructuring data-fetching to boolean-state loading — this just softens the "pop" of the
 * incoming side, which Suspense already swaps in as an unmount/mount (not a re-render).
 */
export function FadeInOnMount({ children }: { children: React.ReactNode }) {
  const { prefersReducedMotion } = useMotionPrefs()
  if (prefersReducedMotion) return <>{children}</>
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={MOTION_SOFT}>
      {children}
    </motion.div>
  )
}
