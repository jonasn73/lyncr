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
  label: string
  description: string
}[] = [
  {
    key: "full_vehicle_key_catalog",
    label: "Full vehicle key lookup",
    description:
      "Gives the same detailed key-cutting catalog owners use (FCC ID search, chip type, programming method) instead of the simple vehicle picker.",
  },
  {
    key: "dispatching",
    label: "Dispatching",
    description: "Lets them see the job board and assign or reassign a tech — the same console you use.",
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
      <DialogContent className="border-zinc-800 bg-zinc-950 text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Access for {target.name}</DialogTitle>
          <DialogDescription className="text-zinc-400">
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
                  "w-full rounded-lg border px-3 py-2.5 text-left transition disabled:opacity-50",
                  on
                    ? "border-emerald-500/50 bg-emerald-500/10"
                    : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-foreground">{toggle.label}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      on ? "bg-emerald-500/20 text-emerald-200" : "bg-zinc-800 text-zinc-500"
                    )}
                  >
                    {on ? "On" : "Off"}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{toggle.description}</p>
              </button>
            )
          })}
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center justify-center rounded-lg border border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
