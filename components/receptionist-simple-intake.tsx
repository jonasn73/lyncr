"use client"

// Minimal post-call notepad — caller name + reason/notes. Reuses the live-intake API.

import { useState } from "react"
import { Check, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"

export function ReceptionistSimpleIntake({
  callLogId,
  callerNumber,
  initialCallerName,
  businessName,
  onSaved,
  onCancel,
}: {
  callLogId: string
  callerNumber: string
  initialCallerName?: string | null
  businessName?: string | null
  onSaved: () => void
  onCancel: () => void
}) {
  const [callerName, setCallerName] = useState(initialCallerName?.trim() || "")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function submit() {
    if (saving || saved) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/receptionist/intake", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callLogId,
          businessType: "generic",
          callerNumber,
          callerName: callerName.trim() || null,
          summary: notes.trim() || `Call noted by receptionist${businessName ? ` for ${businessName}` : ""}.`,
          fields: {
            caller_name: callerName.trim() || null,
            notes: notes.trim() || null,
            reason: notes.trim() || null,
          },
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not save notes")
      setSaved(true)
      window.setTimeout(() => onSaved(), 700)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save notes")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-4">
      <p className="text-xs font-medium text-muted-foreground">Quick intake — name + why they called</p>
      <label className="block space-y-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Caller name</span>
        <input
          type="text"
          value={callerName}
          onChange={(e) => setCallerName(e.target.value)}
          placeholder="e.g. Maria Lopez"
          className="w-full rounded-lg border border-border/70 bg-card/80 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
        />
      </label>
      <label className="block space-y-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Notes / reason</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Lockout on Main St, needs ASAP…"
          className="w-full resize-y rounded-lg border border-border/70 bg-card/80 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
        />
      </label>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {saved ? <p className="text-xs text-success">Saved — owner can see this lead.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || saved || (!callerName.trim() && !notes.trim())}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg bg-success px-3 py-2 text-sm font-semibold text-success-foreground transition hover:bg-success",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
          Save notes
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <X className="h-4 w-4" aria-hidden />
          Cancel
        </button>
      </div>
    </div>
  )
}
