"use client"

// Compact dialog version of the routing-strategy controls, opened straight from the
// Call flow canvas (the "Who answers" primary card and the "Lyncr Network Pool" card).
// Lets the owner flip between private_only / lyncr_only / hybrid_fallback for one line,
// toggle the shared-network fallback, and set how long private staff rings first.
// Wires to GET/PUT /api/routing/strategy (migrations 048/049, fully defensive).

import { useCallback, useEffect, useState } from "react"
import { Loader2, Network, Users, Workflow } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { RoutingStrategy } from "@/lib/types"

// Shape returned by GET/PUT /api/routing/strategy.
export type RoutingStrategyData = {
  routing_strategy: RoutingStrategy
  allow_lyncr_network_fallback: boolean
  private_ring_timeout_seconds: number
}

// The three strategy choices (same copy as the Settings card so the two stay in sync).
const STRATEGY_OPTIONS: {
  value: RoutingStrategy
  title: string
  description: string
  icon: typeof Users
}[] = [
  {
    value: "private_only",
    title: "Only Ring My Team",
    description: "Calls go to your own receptionists. No outside agents ever answer.",
    icon: Users,
  },
  {
    value: "lyncr_only",
    title: "Only Ring Lyncr Network",
    description: "Skip your team — route straight to certified shared Lyncr network agents.",
    icon: Network,
  },
  {
    value: "hybrid_fallback",
    title: "Ring My Team, Fallback to Lyncr",
    description: "Try your own staff first; if nobody's available, hand off to the Lyncr network.",
    icon: Workflow,
  },
]

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The line being edited (E.164). Null edits the account default.
  businessNumber: string | null
  // Seed values so the dialog renders instantly without a flash before the fetch lands.
  initialStrategy: RoutingStrategy
  initialAllowFallback: boolean
  // Called after a successful save so the dashboard can refresh the canvas.
  onSaved: (data: RoutingStrategyData) => void
}

export function RoutingStrategyDialog({
  open,
  onOpenChange,
  businessNumber,
  initialStrategy,
  initialAllowFallback,
  onSaved,
}: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Editable form state — seeded from the dashboard, then refreshed from the server on open.
  const [strategy, setStrategy] = useState<RoutingStrategy>(initialStrategy)
  const [allowFallback, setAllowFallback] = useState(initialAllowFallback)
  const [ringTimeout, setRingTimeout] = useState<string>("15")

  // Pull the full strategy row (incl. ring timeout) whenever the dialog opens.
  const loadStrategy = useCallback(async () => {
    const qs = businessNumber ? `?number=${encodeURIComponent(businessNumber)}` : ""
    const res = await fetch(`/api/routing/strategy${qs}`, { credentials: "include" })
    const json = (await res.json().catch(() => ({}))) as { data?: RoutingStrategyData }
    if (json.data) {
      setStrategy(json.data.routing_strategy)
      setAllowFallback(json.data.allow_lyncr_network_fallback)
      setRingTimeout(String(json.data.private_ring_timeout_seconds ?? 15))
    }
  }, [businessNumber])

  useEffect(() => {
    if (!open) return
    // Seed instantly from the dashboard, then reconcile with the server.
    setStrategy(initialStrategy)
    setAllowFallback(initialAllowFallback)
    let cancelled = false
    setLoading(true)
    loadStrategy()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, initialStrategy, initialAllowFallback, loadStrategy])

  async function onSave() {
    setSaving(true)
    try {
      const timeout = Math.min(60, Math.max(5, Math.round(Number(ringTimeout) || 15)))
      const res = await fetch("/api/routing/strategy", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing_strategy: strategy,
          allow_lyncr_network_fallback: allowFallback,
          private_ring_timeout_seconds: timeout,
          business_number: businessNumber || null,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: RoutingStrategyData; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Save failed")
      if (json.data) onSaved(json.data)
      toast({ title: "Routing strategy saved" })
      window.dispatchEvent(new Event("lyncr-routing-config-changed"))
      onOpenChange(false)
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  // The network-fallback toggle / ring-timeout only matter when private staff ring first.
  const showFallbackToggle = strategy === "private_only"
  const showRingTimeout = strategy === "hybrid_fallback" || (strategy === "private_only" && allowFallback)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[130] border-border/70 bg-background sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10">
              <Network className="h-4 w-4 text-violet-300" aria-hidden />
            </span>
            Call routing strategy
          </DialogTitle>
          <DialogDescription>
            Decide who answers this line: your own team, the shared Lyncr network, or both.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            Loading…
          </div>
        ) : (
          <div className="space-y-4">
            <RadioGroup
              value={strategy}
              onValueChange={(v) => setStrategy(v as RoutingStrategy)}
              className="gap-3"
            >
              {STRATEGY_OPTIONS.map((opt) => {
                const Icon = opt.icon
                const selected = strategy === opt.value
                return (
                  <label
                    key={opt.value}
                    htmlFor={`strategy-dlg-${opt.value}`}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
                      selected
                        ? "border-violet-500/60 bg-violet-500/10"
                        : "border-border/70 bg-muted/20 hover:border-border"
                    )}
                  >
                    <RadioGroupItem id={`strategy-dlg-${opt.value}`} value={opt.value} className="mt-1" />
                    <Icon
                      className={cn("mt-0.5 h-4 w-4 shrink-0", selected ? "text-violet-300" : "text-zinc-500")}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{opt.title}</span>
                      <span className="mt-0.5 block text-xs text-zinc-500">{opt.description}</span>
                    </span>
                  </label>
                )
              })}
            </RadioGroup>

            {showFallbackToggle && (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Allow Lyncr network fallback</p>
                  <p className="text-xs text-zinc-500">
                    If none of your team is available, let a shared Lyncr agent pick up instead of voicemail.
                  </p>
                </div>
                <Switch
                  checked={allowFallback}
                  onCheckedChange={setAllowFallback}
                  disabled={saving}
                  aria-label="Allow Lyncr network fallback"
                />
              </div>
            )}

            {showRingTimeout && (
              <label className="block">
                <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Ring my team for (seconds) before falling back
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={60}
                  step={1}
                  value={ringTimeout}
                  onChange={(e) => setRingTimeout(e.target.value)}
                  disabled={saving}
                  className="w-[8rem] rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm font-semibold text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
                <p className="mt-2 text-xs text-zinc-500">
                  How long your private staff rings before the Lyncr network is tried (5–60s).
                </p>
              </label>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={saving}
                className="rounded-lg border border-border/70 px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void onSave()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save strategy"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
