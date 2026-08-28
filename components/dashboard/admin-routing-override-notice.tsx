"use client"

import { useEffect, useState } from "react"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { cn } from "@/lib/utils"

/** Purple system notice when platform admin has set a direct routing override. */
export function AdminRoutingOverrideNotice({
  active,
  phone,
}: {
  active: boolean
  phone: string
}) {
  const [mounted, setMounted] = useState(active)

  useEffect(() => {
    if (active) {
      setMounted(true)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), 320)
    return () => window.clearTimeout(timer)
  }, [active])

  if (!mounted && !active) return null

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out",
        active ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
      aria-hidden={!active}
    >
      <div className="overflow-hidden">
        <div
          role="status"
          className={cn(
            "rounded-xl border border-operator/50 bg-operator/40 px-4 py-3 text-sm leading-relaxed text-operator",
            "shadow-[0_0_24px_-6px_rgba(168,85,247,0.35)] transition-transform duration-300 ease-out",
            active ? "translate-y-0" : "-translate-y-1"
          )}
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
        </div>
      </div>
    </div>
  )
}
