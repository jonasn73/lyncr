"use client"

// Bottom sheet — pick a locksmith SMS template before sending missed-lead intercept texts.

import { useEffect } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  MISSED_LEAD_SMS_TEMPLATES,
  type MissedLeadSmsTemplate,
} from "@/lib/missed-lead-sms-templates"

export function SmsTemplateInterceptorSheet({
  open,
  sending,
  recipientCount,
  onClose,
  onSelect,
}: {
  open: boolean
  sending?: boolean
  /** How many prospects will receive the chosen template. */
  recipientCount: number
  onClose: () => void
  onSelect: (template: MissedLeadSmsTemplate) => void
}) {
  // Escape closes the sheet when idle.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, sending, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="SMS template picker">
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        aria-label="Dismiss template menu"
        disabled={sending}
        onClick={() => {
          if (!sending) onClose()
        }}
      />
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 bg-slate-950 border-t border-slate-900 rounded-t-2xl p-5 z-50 shadow-2xl",
          "pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-100">Choose intercept text</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Sends to {recipientCount} prospect{recipientCount === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-300 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-3">
          {MISSED_LEAD_SMS_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              disabled={sending}
              onClick={() => onSelect(template)}
              className={cn(
                "w-full text-left p-3.5 bg-slate-900/40 border border-slate-850/60 hover:border-emerald-500/40 rounded-xl transition-all cursor-pointer",
                "touch-manipulation disabled:cursor-wait disabled:opacity-60"
              )}
            >
              <span className="inline-flex rounded-md border border-emerald-900/40 bg-emerald-950/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                {template.badge}
              </span>
              <p className="mt-2 text-[12px] leading-snug text-slate-400 italic line-clamp-3">
                {template.body}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
