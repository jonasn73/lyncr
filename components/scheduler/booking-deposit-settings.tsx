"use client"

// Scheduler setting — require Stripe deposit before /book confirms a slot.

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"

export function BookingDepositSettings() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [requireDeposit, setRequireDeposit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/routing/deposit-settings", { credentials: "include" })
      const json = (await res.json()) as { data?: { require_deposit?: boolean } }
      setRequireDeposit(json.data?.require_deposit === true)
    } catch {
      // Keep default off on transient errors.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">Require deposit on /book</p>
        <p className="text-[11px] text-zinc-500">
          When on, customers pay a Stripe deposit before the calendar slot is confirmed.
        </p>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-400" aria-label="Loading" />
      ) : (
        <Switch
          checked={requireDeposit}
          disabled={saving}
          onCheckedChange={(v) => void handleToggle(v)}
          aria-label="Require deposit on booking link"
          className="shrink-0 data-[state=checked]:bg-amber-500"
        />
      )}
    </div>
  )
}
