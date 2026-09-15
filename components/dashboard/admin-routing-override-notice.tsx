"use client"

import { AnimatePresence, motion } from "framer-motion"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { MOTION_SPRING_LAYOUT } from "@/lib/motion"

/** Purple system notice when platform admin has set a direct routing override. */
export function AdminRoutingOverrideNotice({
  active,
  phone,
}: {
  active: boolean
  phone: string
}) {
  return (
    <AnimatePresence initial={false}>
      {active ? (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={MOTION_SPRING_LAYOUT}
          role="status"
          className="rounded-xl border border-operator/50 bg-operator/40 px-4 py-3 text-sm leading-relaxed text-operator shadow-[0_0_24px_-6px_rgba(168,85,247,0.35)]"
        >
          <p className="flex items-start gap-3">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-operator" aria-hidden />
            <span>
              <span className="font-semibold text-operator">System Notice:</span> Platform Admin has
              configured direct routing override to{" "}
              <span className="font-mono font-semibold text-operator">{formatPhoneDisplay(phone)}</span>.
              Standard routing rules are temporarily bypassed.
            </span>
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
