"use client"

// Scheduler setting — require Stripe deposit before /book confirms a slot.

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export function BookingDepositSettings({ className }: { className?: string }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [requireDeposit, setRequireDeposit] = useState(false)

  // `loading` starts true, so the load only ever has to turn it off. Nothing is
  // written before the first await, and a cancel flag keeps an in-flight
  // response from writing to an unmounted panel.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/routing/deposit-settings", { credentials: "include" })
        const json = (await res.json()) as { data?: { require_deposit?: boolean } }
        if (!cancelled) setRequireDeposit(json.data?.require_deposit === true)
      } catch {
        // Keep default off on transient errors.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleToggle(next: boolean) {
    setRequireDeposit(next)
    setSaving(true)
    try {
      const res = await fetch("/api/routing/deposit-settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ require_deposit: next }),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: string; migration?: string }
        setRequireDeposit(!next)
        toast({
          title: "Could not update deposit setting",
          description: json.migration
            ? `Run ${json.migration} in Neon, then try again.`
            : json.error || res.statusText,
          variant: "destructive",
        })
        return
      }
      toast({
        title: next ? "Deposits required on /book" : "Deposits turned off",
        description: next
          ? "Customers must pay a Stripe deposit before the slot is confirmed."
          : "Public booking confirms slots without a deposit.",
      })
    } catch (e) {
      setRequireDeposit(!next)
      toast({
        title: "Could not update deposit setting",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/30 px-3 py-2",
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-100">Require deposit on /book</p>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
          Customers pay a Stripe deposit before the slot is confirmed.
        </p>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500" aria-label="Loading" />
      ) : (
        <Switch
          checked={requireDeposit}
          disabled={saving}
          onCheckedChange={(v) => void handleToggle(v)}
          aria-label="Require deposit on booking link"
          className="shrink-0"
        />
      )}
    </div>
  )
}
