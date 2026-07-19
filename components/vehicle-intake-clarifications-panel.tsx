"use client"

// Ask-the-customer prompts when year/make/model is ambiguous for key reference.

import { useEffect, useMemo, useRef, useState } from "react"
import { HelpCircle, Sparkles } from "lucide-react"
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
  /** Fired when the server already resolved FCC — pin form without showing Ask banner. */
  onFccAutoResolved?: (option: VehicleClarificationOption) => void
  /** Fired when a key-gating prompt is open (hide Key Details until answered). */
  onPendingKeyClarificationChange?: (pending: boolean) => void
  disabled?: boolean
}

/** True when every FCC option points at the same style / blank family (safe to auto-pick). */
function fccPromptOptionsAreRepetitive(prompt: VehicleClarificationPrompt): boolean {
  const withFcc = prompt.options.filter((option) => option.fccId?.trim())
  if (withFcc.length < 2) return false
  const styles = new Set(
    withFcc.map((option) => (option.keyStyle ?? "").trim().toLowerCase() || "any")
  )
  const skus = withFcc.map((option) => (option.tiSku ?? "").trim().toUpperCase()).filter(Boolean)
  const sameStyle = styles.size <= 1
  const sameSku = skus.length >= 2 && skus.every((sku) => sku === skus[0])
  // Same style with no conflicting SKUs, or identical TI blanks.
  return sameSku || (sameStyle && skus.length <= 1)
}

export function VehicleIntakeClarificationsPanel({
  year,
  make,
  model,
  answeredIds,
  onAnswer,
  onFccAutoResolved,
  onPendingKeyClarificationChange,
  disabled,
}: VehicleIntakeClarificationsPanelProps) {
  const ready = Boolean(year && make && model)
  const [serverPrompts, setServerPrompts] = useState<VehicleClarificationPrompt[]>([])
  /** False until /api/vehicle/clarifications returns — keep Key Details gated meanwhile. */
  const [serverReady, setServerReady] = useState(false)
  /** Local press highlight until the prompt is removed from the list. */
  const [pressedOptionId, setPressedOptionId] = useState<string | null>(null)
  /** Avoid re-pinning the same auto-resolved FCC for one YMM. */
  const autoPinnedKeyRef = useRef<string>("")

  // Show static rules immediately (no wait for API).
  const localPrompts = useMemo(() => {
    if (!ready) return []
    return getVehicleIntakeClarifications(year, make, model, null, answeredIds)
  }, [ready, year, make, model, answeredIds])

  useEffect(() => {
    if (!ready) {
      setServerPrompts([])
      setServerReady(false)
      autoPinnedKeyRef.current = ""
      return
    }
    let cancel = false
    setServerReady(false)
    const q = new URLSearchParams({ year, make, model })
    void fetch(`/api/vehicle/clarifications?${q}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("clarifications"))))
      .then(
        (j: {
          data?: {
            clarifications?: VehicleClarificationPrompt[]
            fcc_resolution?: {
              resolved_fcc_id?: string | null
              preferred_ti_sku?: string | null
              needs_clarification?: boolean
              confidence?: string
            } | null
          }
        }) => {
          if (cancel) return
          setServerPrompts(j.data?.clarifications ?? [])
          setServerReady(true)

          // Server already picked one FCC (or equivalent variants) — pin it and skip the banner.
          const resolution = j.data?.fcc_resolution
          const resolvedFcc = resolution?.resolved_fcc_id?.trim() || ""
          if (
            resolvedFcc &&
            resolution?.needs_clarification === false &&
            onFccAutoResolved
          ) {
            const pinKey = `${year}|${make}|${model}|${resolvedFcc}`
            if (autoPinnedKeyRef.current !== pinKey) {
              autoPinnedKeyRef.current = pinKey
              onFccAutoResolved({
                id: `auto-fcc-${resolvedFcc}`,
                label: `Auto-selected FCC ${resolvedFcc}`,
                fccId: resolvedFcc,
                tiSku: resolution.preferred_ti_sku?.trim() || undefined,
                note: `Auto-selected best-match FCC ${resolvedFcc}${
                  resolution.confidence ? ` (${resolution.confidence} confidence)` : ""
                }`,
              })
            }
          }
        }
      )
      .catch(() => {
        if (!cancel) {
          setServerPrompts([])
          setServerReady(true)
        }
      })
    return () => {
      cancel = true
    }
  }, [year, make, model, ready, onFccAutoResolved])

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
  const lastPendingRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (lastPendingRef.current === keyGatePending) return
    lastPendingRef.current = keyGatePending
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

      {prompts.map((prompt) => {
        const canAutoSelect =
          clarificationGatesKeySelection(prompt) && fccPromptOptionsAreRepetitive(prompt)
        const bestOption = prompt.options.find((option) => option.fccId?.trim()) ?? prompt.options[0]

        return (
          <section key={prompt.id} className="grid gap-2 rounded-md border border-amber-500/25 bg-background/40 p-2.5">
            <p className="text-xs font-medium text-foreground">{prompt.question}</p>
            <p className="text-[11px] italic text-muted-foreground">&ldquo;{prompt.askScript}&rdquo;</p>

            {canAutoSelect && bestOption ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setPressedOptionId(bestOption.id)
                  onAnswer(prompt.id, {
                    ...bestOption,
                    note:
                      bestOption.note?.trim() ||
                      `Auto-selected best match (${bestOption.fccId || bestOption.label})`,
                  })
                }}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/45",
                  "bg-emerald-500/15 px-3 py-2.5 text-xs font-semibold text-emerald-100",
                  "hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Auto-Select Best Match
                {bestOption.fccId ? (
                  <span className="font-mono font-normal opacity-80">({bestOption.fccId})</span>
                ) : null}
              </button>
            ) : null}

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
        )
      })}
    </div>
  )
}
