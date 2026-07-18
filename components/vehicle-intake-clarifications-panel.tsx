"use client"

// Ask-the-customer prompts when year/make/model is ambiguous for key reference.

import { useEffect, useMemo, useState } from "react"
import { HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  getVehicleIntakeClarifications,
  type VehicleClarificationOption,
  type VehicleClarificationPrompt,
} from "@/lib/vehicle-intake-clarifications"

type VehicleIntakeClarificationsPanelProps = {
  year: string
  make: string
  model: string
  answeredIds: ReadonlySet<string>
  onAnswer: (promptId: string, option: VehicleClarificationOption) => void
  disabled?: boolean
}

export function VehicleIntakeClarificationsPanel({
  year,
  make,
  model,
  answeredIds,
  onAnswer,
  disabled,
}: VehicleIntakeClarificationsPanelProps) {
  const ready = Boolean(year && make && model)
  const [serverPrompts, setServerPrompts] = useState<VehicleClarificationPrompt[]>([])

  // Show static rules immediately (no wait for API).
  const localPrompts = useMemo(() => {
    if (!ready) return []
    return getVehicleIntakeClarifications(year, make, model, null, answeredIds)
  }, [ready, year, make, model, answeredIds])

  useEffect(() => {
    if (!ready) {
      setServerPrompts([])
      return
    }
    let cancel = false
    const q = new URLSearchParams({ year, make, model })
    void fetch(`/api/vehicle/clarifications?${q}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("clarifications"))))
      .then((j: { data?: { clarifications?: VehicleClarificationPrompt[] } }) => {
        if (!cancel) setServerPrompts(j.data?.clarifications ?? [])
      })
      .catch(() => {
        if (!cancel) setServerPrompts([])
      })
    return () => {
      cancel = true
    }
  }, [year, make, model, ready])

  const prompts = useMemo(() => {
    const seen = new Set<string>()
    const merged: VehicleClarificationPrompt[] = []
    for (const prompt of [...localPrompts, ...serverPrompts]) {
      if (answeredIds.has(prompt.id) || seen.has(prompt.id)) continue
      seen.add(prompt.id)
      merged.push(prompt)
    }
    return merged
  }, [localPrompts, serverPrompts, answeredIds])

  if (!ready || prompts.length === 0) return null

  return (
    <div className="grid gap-3 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" aria-hidden />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-100">Ask the customer</p>
          <p className="mt-0.5 text-[11px] text-amber-100/80">
            Answer these to lock the correct key / FCC before ordering.
          </p>
        </div>
      </div>

      {prompts.map((prompt) => (
        <section key={prompt.id} className="grid gap-2 rounded-md border border-amber-500/25 bg-background/40 p-2.5">
          <p className="text-xs font-medium text-foreground">{prompt.question}</p>
          <p className="text-[11px] italic text-muted-foreground">&ldquo;{prompt.askScript}&rdquo;</p>
          <div className="flex flex-wrap gap-2">
            {prompt.options.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                onClick={() => onAnswer(prompt.id, option)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-left text-xs font-medium transition-colors",
                  "border-amber-500/40 bg-background hover:border-primary hover:bg-primary/10 hover:text-primary",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
