"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Network, Users, Workflow } from "lucide-react"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { workspaceFieldClass } from "@/components/dashboard-workspace-ui"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { RoutingStrategy } from "@/lib/types"

type LineRow = { number: string; status?: string; label?: string | null }

type StrategyData = {
  routing_strategy: RoutingStrategy
  allow_lyncr_network_fallback: boolean
  private_ring_timeout_seconds: number
}

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

function formatLineLabel(line: LineRow): string {
  const digits = line.number.replace(/\D/g, "")
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (ten.length === 10) {
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  }
  return line.number
}

type Props = {
  onSaved?: () => void
}

export function RoutingStrategyForm({ onSaved }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lines, setLines] = useState<LineRow[]>([])
  const [activeNumber, setActiveNumber] = useState<string>("")
  const [strategy, setStrategy] = useState<RoutingStrategy>("private_only")
  const [allowFallback, setAllowFallback] = useState(false)
  const [ringTimeout, setRingTimeout] = useState<string>("15")

  const loadStrategy = useCallback(async (number: string) => {
    const qs = number ? `?number=${encodeURIComponent(number)}` : ""
    const res = await fetch(`/api/routing/strategy${qs}`, { credentials: "include" })
    const json = (await res.json().catch(() => ({}))) as { data?: StrategyData }
    if (json.data) {
      setStrategy(json.data.routing_strategy)
      setAllowFallback(json.data.allow_lyncr_network_fallback)
      setRingTimeout(String(json.data.private_ring_timeout_seconds ?? 15))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/numbers/mine", { credentials: "include" })
        const json = (await res.json().catch(() => ({}))) as { numbers?: LineRow[] }
        const list = Array.isArray(json.numbers) ? json.numbers : []
        if (cancelled) return
        setLines(list)
        const firstActive = list.find((n) => n.status === "active") ?? list[0]
        const number = firstActive?.number ?? ""
        setActiveNumber(number)
        await loadStrategy(number)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadStrategy])

  async function onChangeLine(number: string) {
    setActiveNumber(number)
    setLoading(true)
    try {
      await loadStrategy(number)
    } finally {
      setLoading(false)
    }
  }

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
          business_number: activeNumber || null,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: StrategyData; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Save failed")
      if (json.data) {
        setStrategy(json.data.routing_strategy)
        setAllowFallback(json.data.allow_lyncr_network_fallback)
        setRingTimeout(String(json.data.private_ring_timeout_seconds ?? 15))
      }
      toast({ title: "Routing strategy saved" })
      onSaved?.()
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

  const showFallbackToggle = strategy === "private_only"
  const showRingTimeout = strategy === "hybrid_fallback" || (strategy === "private_only" && allowFallback)

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Loading…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {lines.length > 1 ? (
        <label className="block">
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Which line
          </span>
          <Select value={activeNumber} onValueChange={(v) => void onChangeLine(v)} disabled={saving}>
            <SelectTrigger className={workspaceFieldClass}>
              <SelectValue placeholder="Select a line" />
            </SelectTrigger>
            <SelectContent>
              {lines.map((line) => (
                <SelectItem key={line.number} value={line.number}>
                  {formatLineLabel(line)}
                  {line.status && line.status !== "active" ? ` · ${line.status}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : null}

      <RadioGroup value={strategy} onValueChange={(v) => setStrategy(v as RoutingStrategy)} className="gap-3">
        {STRATEGY_OPTIONS.map((opt) => {
          const Icon = opt.icon
          const selected = strategy === opt.value
          return (
            <label
              key={opt.value}
              htmlFor={`routing-strategy-${opt.value}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
                selected ? "border-violet-500/60 bg-violet-500/10" : "border-border/70 bg-muted/20 hover:border-border"
              )}
            >
              <RadioGroupItem id={`routing-strategy-${opt.value}`} value={opt.value} className="mt-1" />
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

      {showFallbackToggle ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Allow Lyncr network fallback</p>
            <p className="text-xs text-zinc-500">
              If none of your team is available, let a shared Lyncr agent pick up instead of going to voicemail.
            </p>
          </div>
          <Switch
            checked={allowFallback}
            onCheckedChange={setAllowFallback}
            disabled={saving}
            aria-label="Allow Lyncr network fallback"
          />
        </div>
      ) : null}

      {showRingTimeout ? (
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
            className={cn(workspaceFieldClass, "max-w-[8rem]")}
          />
        </label>
      ) : null}

      <button
        type="button"
        disabled={saving}
        onClick={() => void onSave()}
        className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save routing strategy"}
      </button>
    </div>
  )
}
