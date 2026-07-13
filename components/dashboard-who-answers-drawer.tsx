"use client"

// Unified Who Answers — single active_routing_mode radio + conditional panels.

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { submitFormEvent } from "@/lib/form-keyboard"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import {
  DrawerScrollBody,
  DrawerStepHeader,
  DrawerStickyFooter,
} from "@/components/dashboard-routing-drawer-shared"
import { IvrGreetingsSettingsForm } from "@/components/dashboard/ivr-greetings-settings-form"
import { PresenceAutomationGreetingsForm } from "@/components/dashboard/presence-automation-greetings-form"
import {
  ACTIVE_ROUTING_MODE_OPTIONS,
  LYNCR_ROUTING_MODE_CHANGED,
  normalizeActiveRoutingMode,
  type ActiveRoutingMode,
} from "@/lib/active-routing-mode"

const fieldClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/40"

const RING_OPTIONS = [15, 20, 30, 45, 60] as const

export type DashboardWhoAnswersDrawerProps = {
  receptionists?: unknown
  selectedReceptionistId?: string | null
  ownerPhoneDisplay: string
  saveRouting: (updates: Record<string, unknown>, opts?: { quiet?: boolean }) => Promise<void>
  onClose: () => void
  onRegisterDiscard?: (discard: () => void) => void
  routingBusinessNumber: string | null
  routingLineDetailLoading?: boolean
  onChangeRoutingStrategy?: () => void
  routingStrategy?: string
  setRoutingStrategy: (s: "private_only" | "lyncr_only" | "hybrid_fallback") => void
}

export function DashboardWhoAnswersDrawer({
  ownerPhoneDisplay,
  saveRouting,
  onClose,
  onRegisterDiscard,
  routingBusinessNumber,
  routingLineDetailLoading,
  setRoutingStrategy,
}: DashboardWhoAnswersDrawerProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<ActiveRoutingMode>("your_phone")
  const [customPhone, setCustomPhone] = useState("")
  const [ringTimeout, setRingTimeout] = useState(30)
  const baselineRef = useRef("")

  const snapshot = useCallback(
    () =>
      JSON.stringify({
        mode,
        customPhone: customPhone.trim(),
        ringTimeout,
      }),
    [mode, customPhone, ringTimeout]
  )

  // Load only when the selected line changes — do not depend on `snapshot`/`mode`
  // or every radio click would re-fetch and wipe the selection back to the DB value.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = routingBusinessNumber
        ? `?number=${encodeURIComponent(routingBusinessNumber)}`
        : ""
      const modeRes = await fetch(`/api/routing/mode${qs}`, { credentials: "include" })
      const modeJson = (await modeRes.json()) as {
        data?: {
          activeRoutingMode?: string
          customRoutingPhone?: string | null
          ringTimeoutSeconds?: number
        }
      }
      const nextMode = normalizeActiveRoutingMode(modeJson.data?.activeRoutingMode)
      const nextPhone = modeJson.data?.customRoutingPhone || ""
      const nextRing = Number(modeJson.data?.ringTimeoutSeconds ?? 30)
      const phoneDigits = nextPhone.replace(/^\+1/, "").replace(/\D/g, "").slice(-10)
      const ring = RING_OPTIONS.includes(nextRing as (typeof RING_OPTIONS)[number]) ? nextRing : 30
      setMode(nextMode)
      setCustomPhone(phoneDigits)
      setRingTimeout(ring)
      baselineRef.current = JSON.stringify({
        mode: nextMode,
        customPhone: phoneDigits,
        ringTimeout: ring,
      })
    } catch {
      baselineRef.current = JSON.stringify({
        mode: "your_phone",
        customPhone: "",
        ringTimeout: 30,
      })
    } finally {
      setLoading(false)
    }
  }, [routingBusinessNumber])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    onRegisterDiscard?.(() => {
      void load()
    })
  }, [onRegisterDiscard, load])

  const dirty = snapshot() !== baselineRef.current

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/routing/mode", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_number: routingBusinessNumber,
          active_routing_mode: mode,
          custom_routing_phone: mode === "custom_routing" ? customPhone : null,
          ring_timeout_seconds: mode === "your_phone" ? ringTimeout : undefined,
        }),
      })
      const json = (await res.json()) as { error?: string; migration?: string; data?: unknown }
      if (!res.ok) {
        toast({
          title: "Could not save routing mode",
          description: json.migration
            ? `Run ${json.migration} in Neon, then try again.`
            : json.error || res.statusText,
          variant: "destructive",
        })
        return
      }

      // Keep local dashboard strategy badge in sync.
      if (mode === "lyncr_pool") setRoutingStrategy("lyncr_only")
      else setRoutingStrategy("private_only")

      // Persist ring timeout through the classic routing API when Your Phone is selected.
      if (mode === "your_phone") {
        await saveRouting(
          { ring_timeout_seconds: ringTimeout, selected_receptionist_id: null },
          { quiet: true }
        )
      } else {
        await saveRouting({ selected_receptionist_id: null }, { quiet: true })
      }

      baselineRef.current = snapshot()
      // Refresh Lines Call Flow so IVR deck shows/hides from the saved primary mode.
      window.dispatchEvent(
        new CustomEvent(LYNCR_ROUTING_MODE_CHANGED, {
          detail: { mode, businessNumber: routingBusinessNumber },
        })
      )
      toast({
        title: "Routing mode saved",
        description: ACTIVE_ROUTING_MODE_OPTIONS.find((o) => o.value === mode)?.label,
      })
      onClose()
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        submitFormEvent(e)
        if (!saving) void handleSave()
      }}
    >
      <DrawerStepHeader
        step="Step 2 · Who answers"
        title="Who answers"
        subtitle={`Pick one routing mode for ${ownerPhoneDisplay || "this line"}. Conditional settings appear below.`}
      />

      <DrawerScrollBody>
        {loading || routingLineDetailLoading ? (
          <div className="flex items-center gap-2 py-8 text-xs text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading routing mode…
          </div>
        ) : (
          <div className="space-y-5">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Active routing mode
              </legend>
              <div
                role="radiogroup"
                aria-label="Active routing mode"
                className="relative z-10 space-y-2"
              >
                {ACTIVE_ROUTING_MODE_OPTIONS.map((opt) => {
                  const active = mode === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setMode(opt.value)}
                      className={cn(
                        "relative z-10 flex w-full cursor-pointer gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                        "pointer-events-auto touch-manipulation",
                        active
                          ? "border-emerald-500/40 bg-emerald-500/10"
                          : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                          active
                            ? "border-emerald-400 bg-emerald-500/20"
                            : "border-zinc-600 bg-transparent"
                        )}
                      >
                        {active ? (
                          <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-foreground">
                          {opt.label}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                          {opt.description}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {mode === "smart_ivr" ? (
              <>
                <IvrGreetingsSettingsForm routingBusinessNumber={routingBusinessNumber} />
                <PresenceAutomationGreetingsForm />
              </>
            ) : (
              <PresenceAutomationGreetingsForm />
            )}

            {mode === "your_phone" ? (
              <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Backup ring delay
                </p>
                <p className="text-[11px] text-zinc-500">
                  How long to ring your cell before falling back to Voice &amp; AI / voicemail.
                </p>
                <div className="flex flex-wrap gap-2">
                  {RING_OPTIONS.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => setRingTimeout(sec)}
                      className={cn(
                        "min-h-10 rounded-lg border px-3 text-sm font-semibold",
                        ringTimeout === sec
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-zinc-800 text-zinc-300 hover:border-zinc-600"
                      )}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {mode === "custom_routing" ? (
              <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <label htmlFor="custom-routing-phone" className="text-xs font-semibold text-zinc-300">
                  Target 10-digit phone number
                </label>
                <input
                  id="custom-routing-phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="5025551234"
                  value={customPhone}
                  onChange={(e) => setCustomPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className={cn(fieldClass, "h-11")}
                />
                <p className="text-[10px] text-zinc-600">
                  Every inbound call to this business line forwards to this number.
                </p>
              </section>
            ) : null}

            {mode === "lyncr_pool" ? (
              <p className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2.5 text-[11px] text-violet-200/90">
                Lyncr Pool is active — certified shared agents answer in-browser. No extra phone
                settings needed.
              </p>
            ) : null}
          </div>
        )}
      </DrawerScrollBody>

      <DrawerStickyFooter
        dirty={dirty}
        saving={saving}
        onSave={() => void handleSave()}
        onCancel={() => {
          void load()
          onClose()
        }}
        saveLabel="Save routing mode"
        saveAsSubmit
      />
    </form>
  )
}
