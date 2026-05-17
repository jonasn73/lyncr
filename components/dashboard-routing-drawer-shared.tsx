"use client"

import { Loader2, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

export const routingFieldClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm text-foreground transition-colors duration-200 placeholder:text-zinc-600 hover:border-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500/40"

export function DrawerStepHeader({
  step,
  title,
  subtitle,
  lineLabel,
}: {
  step: string
  title: string
  subtitle: string
  lineLabel?: string | null
}) {
  return (
    <header className="shrink-0 border-b border-zinc-800/80 bg-gradient-to-b from-zinc-900/80 to-transparent px-6 pb-5 pt-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">{step}</p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-zinc-500">{subtitle}</p>
      {lineLabel ? <p className="mt-2 text-[11px] text-zinc-600">{lineLabel}</p> : null}
    </header>
  )
}

export function DrawerScrollBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6", className)}>{children}</div>
}

export function DrawerStickyFooter({
  dirty,
  saving,
  onSave,
  onCancel,
  saveLabel = "Save Changes",
}: {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onCancel: () => void
  saveLabel?: string
}) {
  return (
    <footer className="sticky bottom-0 shrink-0 border-t border-zinc-800/80 bg-zinc-950 px-6 py-4">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:bg-primary/90 disabled:opacity-60",
            dirty && "ring-1 ring-primary/50"
          )}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-zinc-800 bg-transparent px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors duration-200 hover:border-zinc-600 hover:bg-zinc-900/50 hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </footer>
  )
}

