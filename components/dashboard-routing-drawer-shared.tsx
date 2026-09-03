"use client"

import { Loader2, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

export function DrawerStepHeader({
  step,
  title,
  subtitle,
  lineLabel,
}: {
  step?: string | null
  title: string
  subtitle: string
  lineLabel?: string | null
}) {
  return (
    <header className="shrink-0 border-b border-border/80 bg-gradient-to-b from-card/80 to-transparent px-6 pb-6 pt-6">
      {step?.trim() ? (
        <p className="text-micro font-semibold uppercase tracking-[0.14em] text-primary">{step}</p>
      ) : null}
      <h2
        className={cn(
          "text-xl font-semibold tracking-tight text-foreground",
          step?.trim() ? "mt-2" : "mt-0"
        )}
      >
        {title}
      </h2>
      {subtitle.trim() ? (
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
      ) : null}
      {lineLabel ? <p className="mt-2 text-2xs text-muted-foreground">{lineLabel}</p> : null}
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
  saveAsSubmit = false,
  /** Set false when the primary button is reused as a plain "Close" (not a real save) —
   * otherwise `!dirty` leaves it permanently disabled. */
  dirtyGated = true,
}: {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onCancel: () => void
  saveLabel?: string
  saveAsSubmit?: boolean
  dirtyGated?: boolean
}) {
  return (
    <footer className="sticky bottom-0 shrink-0 border-t border-border/80 bg-background px-6 py-4">
      <div className="flex gap-3">
        <button
          type={saveAsSubmit ? "submit" : "button"}
          onClick={saveAsSubmit ? undefined : onSave}
          disabled={saving || (dirtyGated && !dirty)}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50",
            dirty && !saving && "ring-1 ring-primary/50"
          )}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-border bg-transparent px-4 py-3 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:border-border hover:bg-card/50 hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </footer>
  )
}

