"use client"

// Owner-facing editor for what a receptionist's live-call console can do.
//
// One flag today (the vehicle key catalog), more to come — the toggle list below is the
// one place a new capability needs a UI; the data model (receptionists.capabilities) and
// the PATCH route already merge whatever keys are sent without touching the rest.

import { useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { RECEPTIONIST_CAPABILITY_LABELS } from "@/lib/receptionist-capabilities"
import type { ReceptionistCapabilities } from "@/lib/types"

export interface ReceptionistAccessTarget {
  id: string
  name: string
  capabilities: ReceptionistCapabilities
}

interface ReceptionistAccessEditorProps {
  target: ReceptionistAccessTarget | null
  onClose: () => void
  onSaved: (capabilities: ReceptionistCapabilities) => void
}

const CAPABILITY_TOGGLES: {
  key: keyof ReceptionistCapabilities
  description: string
}[] = [
  {
    key: "full_vehicle_key_catalog",
    description:
      "Gives the same detailed key-cutting catalog owners use (FCC ID search, chip type, programming method) instead of the simple vehicle picker.",
  },
  {
    key: "dispatching",
    description: "Lets them see the job board and assign or reassign a tech — the same console you use.",
  },
  {
    key: "crm_access",
    description:
      "Opens your CRM to them — customer list, profiles, vehicles, and service history. Taking intake already works without this.",
  },
  {
    key: "crm_edit",
    description:
      "Lets them correct a name, add notes, fix a vehicle, or move a lead's appointment. Needs the customer book above.",
  },
  {
    key: "scheduler",
    description: "Your calendar, live: they can see the schedule, book onto it, and set blockouts.",
  },
  {
    key: "invoicing",
    description: "Read-only view of invoices and payment records. They cannot send anything with this alone.",
  },
  {
    key: "invoicing_send",
    description:
      "Lets them send or revise an invoice to a customer. This one leaves the building — turn it on deliberately.",
  },
]

export function ReceptionistAccessEditor({ target, onClose, onSaved }: ReceptionistAccessEditorProps) {
  if (!target) return null
  return <ReceptionistAccessForm key={target.id} target={target} onClose={onClose} onSaved={onSaved} />
}

function ReceptionistAccessForm({
  target,
  onClose,
  onSaved,
}: {
  target: ReceptionistAccessTarget
  onClose: () => void
  onSaved: (capabilities: ReceptionistCapabilities) => void
}) {
  const [capabilities, setCapabilities] = useState<ReceptionistCapabilities>(target.capabilities)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/receptionists/${target.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilities }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { capabilities?: ReceptionistCapabilities }
      }
      if (!res.ok) throw new Error(json.error ?? "Could not update access")
      onSaved(json.data?.capabilities ?? capabilities)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update access")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="border-border bg-background text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Access for {target.name}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Choose what shows up on their console. Off by default — turn something on when you
            want them handling more.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {CAPABILITY_TOGGLES.map((toggle) => {
            const on = capabilities[toggle.key] === true
            return (
              <button
                key={toggle.key}
                type="button"
                disabled={saving}
                onClick={() => setCapabilities((prev) => ({ ...prev, [toggle.key]: !on }))}
                className={cn(
                  "w-full rounded-lg border px-3 py-3 text-left transition disabled:opacity-50",
                  on
                    ? "border-success/50 bg-success/10"
                    : "border-border bg-card/40 hover:border-border"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-foreground">{RECEPTIONIST_CAPABILITY_LABELS[toggle.key]}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-wide",
                      on ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {on ? "On" : "Off"}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{toggle.description}</p>
              </button>
            )
          })}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-success hover:bg-success disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
