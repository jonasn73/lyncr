"use client"

// Ask-the-customer prompts when year/make/model is ambiguous for key reference.

import { useEffect, useMemo, useState } from "react"
import { HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  clarificationGatesKeySelection,
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
  /** Fired when a key-gating prompt is open (hide Key Details until answered). */
  onPendingKeyClarificationChange?: (pending: boolean) => void
  disabled?: boolean
}

export function VehicleIntakeClarificationsPanel({
  year,
  make,
  model,
  answeredIds,
  onAnswer,
  onPendingKeyClarificationChange,
  disabled,
}: VehicleIntakeClarificationsPanelProps) {
  const ready = Boolean(year && make && model)
  const [serverPrompts, setServerPrompts] = useState<VehicleClarificationPrompt[]>([])
  /** False until /api/vehicle/clarifications returns — keep Key Details gated meanwhile. */
  const [serverReady, setServerReady] = useState(false)
  /** Local press highlight until the prompt is removed from the list. */
  const [pressedOptionId, setPressedOptionId] = useState<string | null>(null)

  // Show static rules immediately (no wait for API).
  const localPrompts = useMemo(() => {
    if (!ready) return []
    return getVehicleIntakeClarifications(year, make, model, null, answeredIds)
  }, [ready, year, make, model, answeredIds])

  useEffect(() => {
    if (!ready) {
      setServerPrompts([])
      setServerReady(false)
      return
    }
    let cancel = false
    setServerReady(false)
    const q = new URLSearchParams({ year, make, model })
    void fetch(`/api/vehicle/clarifications?${q}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("clarifications"))))
      .then((j: { data?: { clarifications?: VehicleClarificationPrompt[] } }) => {
        if (!cancel) {
          setServerPrompts(j.data?.clarifications ?? [])
          setServerReady(true)
        }
      })
      .catch(() => {
        if (!cancel) {
          setServerPrompts([])
          setServerReady(true)
        }
      })
    return () => {
      cancel = true
    }
  }, [year, make, model, ready])

  useEffect(() => {
    setPressedOptionId(null)
  }, [year, make, model])

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

  // Gate keys while clarifications load, and while any key-gating prompt is still open.
  const keyGatePending =
    (ready && !serverReady) || prompts.some(clarificationGatesKeySelection)

  useEffect(() => {
    onPendingKeyClarificationChange?.(keyGatePending)
  }, [keyGatePending, onPendingKeyClarificationChange])

  // Clear pending flag when this panel unmounts so Key Details can show again.
  useEffect(() => {
    return () => {
      onPendingKeyClarificationChange?.(false)
    }
  }, [onPendingKeyClarificationChange])

  if (!ready || prompts.length === 0) return null

  return (
    <div className="grid gap-3 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" aria-hidden />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-100">Ask the customer</p>
          <p className="mt-0.5 text-[11px] text-amber-100/80">
            {keyGatePending
              ? "Answer this before we show a key blank — push-start and turn-key use different parts."
              : "Answer these to lock the correct vehicle / key before ordering."}
          </p>
        </div>
      </div>

      {prompts.map((prompt) => (
        <section key={prompt.id} className="grid gap-2 rounded-md border border-amber-500/25 bg-background/40 p-2.5">
          <p className="text-xs font-medium text-foreground">{prompt.question}</p>
          <p className="text-[11px] italic text-muted-foreground">&ldquo;{prompt.askScript}&rdquo;</p>
          <div className="flex flex-wrap gap-2">
            {prompt.options.map((option) => {
              const selected = pressedOptionId === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => {
                    setPressedOptionId(option.id)
                    onAnswer(prompt.id, option)
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    selected
                      ? "border-primary bg-primary/20 text-primary ring-1 ring-primary/40"
                      : "border-amber-500/40 bg-background hover:border-primary hover:bg-primary/10 hover:text-primary"
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
