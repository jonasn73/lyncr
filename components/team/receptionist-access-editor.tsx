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
import { FIELD_TECH_CAPABILITY_LABELS } from "@/lib/field-technician-capabilities"
import type { FieldTechnicianCapabilities, ReceptionistCapabilities } from "@/lib/types"

/** A flat on/off map — whichever registry the dialog was handed. */
export type CapabilityFlags = Record<string, boolean>

export interface ReceptionistAccessTarget {
  id: string
  name: string
  capabilities: CapabilityFlags
}

interface ReceptionistAccessEditorProps {
  target: ReceptionistAccessTarget | null
  onClose: () => void
  onSaved: (capabilities: CapabilityFlags) => void
}

export const CAPABILITY_TOGGLES: {
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
  {
    key: "call_intake",
    description:
      "Lets them take intake on a call, using your own intake form — same questions, same quoting, key lookup and scheduling. Off means no intake form at their desk at all.",
  },
]

export function ReceptionistAccessEditor({ target, onClose, onSaved }: ReceptionistAccessEditorProps) {
  if (!target) return null
  return (
    <ReceptionistAccessForm
      key={target.id}
      target={target}
      onClose={onClose}
      onSaved={onSaved}
      endpoint="/api/receptionists"
      toggles={CAPABILITY_TOGGLES}
      labels={RECEPTIONIST_CAPABILITY_LABELS}
    />
  )
}

/** Same dialog, the field-tech capability list. One editor, two registries. */
export function FieldTechAccessEditor({ target, onClose, onSaved }: ReceptionistAccessEditorProps) {
  if (!target) return null
  return (
    <ReceptionistAccessForm
      key={target.id}
      target={target}
      onClose={onClose}
      onSaved={onSaved}
      endpoint="/api/technicians"
      toggles={FIELD_TECH_CAPABILITY_TOGGLES}
      labels={FIELD_TECH_CAPABILITY_LABELS}
    />
  )
}

export const FIELD_TECH_CAPABILITY_TOGGLES: {
  key: keyof FieldTechnicianCapabilities
  description: string
}[] = [
  {
    key: "job_pool",
    description:
      "Lets them see unassigned work and claim it themselves. Off means they only get jobs you dispatch to them.",
  },
  {
    key: "customer_contact",
    description: "Shows the customer's number on the job card so they can call ahead from the road.",
  },
  {
    key: "collect_payment",
    description:
      "Lets them take payment on site — card, tap to pay, or a pay link. This one handles your money.",
  },
  {
    key: "view_earnings",
    description: "Shows their own wallet: what they have earned and what is still owed to them.",
  },
]

function ReceptionistAccessForm({
  target,
  onClose,
  onSaved,
  endpoint,
  toggles,
  labels,
}: {
  target: ReceptionistAccessTarget
  onClose: () => void
  onSaved: (capabilities: CapabilityFlags) => void
  /** Collection route the PATCH goes to — `/api/receptionists` or `/api/technicians`. */
  endpoint: string
  /** Capability list for this role. A tech is not a receptionist with fewer buttons. */
  toggles: readonly { key: string; description: string }[]
  labels: Record<string, string>
}) {
  const [capabilities, setCapabilities] = useState<CapabilityFlags>(target.capabilities)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${endpoint}/${target.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilities }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { capabilities?: CapabilityFlags }
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
          {toggles.map((toggle) => {
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
                  <span className="text-sm font-semibold text-foreground">{labels[toggle.key]}</span>
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
