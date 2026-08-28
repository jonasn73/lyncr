"use client"

// One-screen missed-call note — purpose chips + notes, no YMM / multi-step booking.

import { useState } from "react"
import { Loader2, Phone, ClipboardList } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { buildTelHref, toE164 } from "@/lib/phone-e164"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { softInvalidateOperationsDataCache } from "@/lib/hooks/use-operations-data"
import { LYNCR_ACTIVITY_REFRESH_EVENT } from "@/lib/lync-engine-bus"
import { notifyWorkspaceDataChanged } from "@/lib/workspace-organizations"
import { cn } from "@/lib/utils"

/** Quick purpose chips — what the missed call was about (not a full booking path). */
const PURPOSE_CHIPS = [
  "Vehicle lockout",
  "Car key / fob",
  "Home lockout",
  "Re-key / install",
  "Quote / pricing",
  "Wrong number",
  "Other",
] as const

type QuickLogOutcome = "callback" | "saved" | "not_a_lead"

export type MissedCallQuickLogPanelProps = {
  phoneNumber: string
  callLogId: string | null
  customerName?: string | null
  organizationId?: string | null
  onSaved: () => void
  onBookJob: () => void
  onDismiss: () => void
}

export function MissedCallQuickLogPanel({
  phoneNumber,
  callLogId,
  customerName: initialName,
  organizationId,
  onSaved,
  onBookJob,
  onDismiss,
}: MissedCallQuickLogPanelProps) {
  // Selected purpose chip (or empty until they pick / type).
  const [purpose, setPurpose] = useState("")
  // Free-text “what was this about”.
  const [notes, setNotes] = useState("")
  // Optional name if they know the caller.
  const [name, setName] = useState(
    initialName && initialName !== "Unknown Caller" ? initialName : ""
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const phoneDisplay = formatPhoneDisplay(phoneNumber) || phoneNumber
  const e164 = toE164(phoneNumber) || phoneNumber.trim()
  const telHref = buildTelHref(phoneNumber)
  const canSave = Boolean(purpose.trim() || notes.trim())

  async function save(outcome: QuickLogOutcome, opts?: { dialAfter?: boolean }): Promise<boolean> {
    if (!canSave) {
      setError("Pick what it was about, or type a short note.")
      return false
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/calls/quick-log", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_log_id: callLogId,
          phone_number: e164,
          purpose: purpose.trim(),
          notes: notes.trim(),
          customer_name: name.trim() || null,
          outcome,
          organization_id: organizationId ?? null,
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not save")
      // Refresh Activities badges immediately (CRM loads its own list on visit).
      softInvalidateOperationsDataCache()
      window.dispatchEvent(new CustomEvent(LYNCR_ACTIVITY_REFRESH_EVENT))
      notifyWorkspaceDataChanged({
        reason: "missed-call-quick-log",
        organizationId: organizationId ?? null,
      })
      // Dial before closing so the tel: handoff is not lost with the sheet.
      if (opts?.dialAfter && telHref) {
        window.location.href = telHref
      }
      onSaved()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save")
      return false
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <div>
          <p className="text-micro font-semibold uppercase tracking-wide text-rose-300">
            Missed call
          </p>
          <p className="mt-1 flex items-center gap-2 text-lg font-semibold tabular-nums text-foreground">
            <Phone className="h-5 w-5 shrink-0 text-rose-300" aria-hidden />
            {phoneDisplay}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Quick note only — no year / make / model required.
          </p>
        </div>

        <div>
          <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            What was it about?
          </p>
          <div className="flex flex-wrap gap-2">
            {PURPOSE_CHIPS.map((chip) => {
              const active = purpose === chip
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setPurpose(chip)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs font-semibold transition-colors",
                    active
                      ? "border-rose-400/50 bg-rose-500/15 text-rose-100"
                      : "border-border/80 bg-card/40 text-foreground hover:border-rose-400/35 hover:bg-muted hover:text-rose-100"
                  )}
                  aria-pressed={active}
                >
                  {chip}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label htmlFor="missed-quick-notes" className="mb-1.5 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Notes
          </label>
          <Textarea
            id="missed-quick-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything to remember — address hint, what they said, when to call back…"
            rows={3}
            className="resize-none border-border/80 bg-background/50 text-sm"
          />
        </div>

        <div>
          <label htmlFor="missed-quick-name" className="mb-1.5 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Caller name <span className="font-normal normal-case text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="missed-quick-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="If you know who it was"
            className="border-border/80 bg-background/50"
          />
        </div>

        {error ? <p className="text-xs text-rose-300">{error}</p> : null}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border/60 bg-card/40 px-4 py-3">
        {telHref ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full gap-2 border-rose-500/40 bg-rose-500/10 font-semibold text-rose-100 hover:bg-rose-500/20"
            disabled={saving}
            onClick={() => void save("callback", { dialAfter: true })}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Phone className="h-4 w-4" aria-hidden />}
            Save & call back
          </Button>
        ) : null}

        <Button
          type="button"
          className="h-11 w-full gap-2 font-semibold"
          disabled={saving || !canSave}
          onClick={() => void save("saved")}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ClipboardList className="h-4 w-4" aria-hidden />}
          Save note
        </Button>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 text-xs"
            disabled={saving}
            onClick={onBookJob}
          >
            Full booking…
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11 flex-1 text-xs text-muted-foreground"
            disabled={saving}
            onClick={() => {
              if (purpose || notes) {
                void save("not_a_lead")
                return
              }
              onDismiss()
            }}
          >
            {purpose || notes ? "Not a lead" : "Dismiss"}
          </Button>
        </div>
      </div>
    </div>
  )
}
