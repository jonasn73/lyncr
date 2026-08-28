"use client"

// Settings sheet: default sales tax for Collect / Charge.

import { useEffect, useState } from "react"
import { Loader2, Percent } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"

export function SalesTaxSettingsSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabledDefault, setEnabledDefault] = useState(true)
  const [ratePercent, setRatePercent] = useState("6")

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch("/api/settings/sales-tax", {
          credentials: "include",
          cache: "no-store",
        })
        const json = (await res.json().catch(() => ({}))) as {
          data?: { enabledDefault?: boolean; ratePercent?: number }
          error?: string
        }
        if (cancelled) return
        if (!res.ok) throw new Error(json.error || "Could not load tax settings")
        setEnabledDefault(json.data?.enabledDefault !== false)
        setRatePercent(
          typeof json.data?.ratePercent === "number"
            ? String(json.data.ratePercent)
            : "6"
        )
      } catch (e) {
        if (!cancelled) {
          toast({
            title: "Could not load tax settings",
            description: e instanceof Error ? e.message : "Try again",
            variant: "destructive",
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, toast])

  async function save() {
    setSaving(true)
    try {
      const rate = parseFloat(ratePercent)
      const res = await fetch("/api/settings/sales-tax", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          enabledDefault,
          ratePercent: Number.isFinite(rate) ? rate : 6,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        migration?: string
      }
      if (!res.ok) {
        throw new Error(
          json.migration
            ? `${json.error || "Needs database update"} Run ${json.migration} in Neon.`
            : json.error || "Could not save"
        )
      }
      toast({
        title: "Sales tax saved",
        description: enabledDefault
          ? `Charge will open with ${ratePercent}% tax on.`
          : "Charge will open with tax off (you can still turn it on per job).",
      })
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl border-zinc-800 bg-[#101018] p-0"
      >
        <SheetHeader className="shrink-0 border-b border-zinc-800 px-4 pb-3 pt-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base text-slate-100">
            <Percent className="h-4 w-4 text-emerald-400" aria-hidden />
            Sales tax default
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Controls how Charge / Collect opens. You can still flip tax on or off for one job.
          </p>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading…
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-100">Add sales tax by default</p>
                  <p className="text-2xs text-muted-foreground">
                    Recommended on so you don’t forget tax on pay links.
                  </p>
                </div>
                <Switch
                  checked={enabledDefault}
                  onCheckedChange={setEnabledDefault}
                  aria-label="Add sales tax by default"
                />
              </div>

              <label className="block rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-3">
                <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                  Default tax %
                </span>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="30"
                    step="0.01"
                    value={ratePercent}
                    onChange={(e) => setRatePercent(e.target.value)}
                    disabled={!enabledDefault}
                    className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-right text-sm tabular-nums text-white outline-none disabled:opacity-40"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </label>

              <Button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="h-11 w-full bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Save"}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
