"use client"

import { useCallback, useEffect, useState } from "react"
import { Hash, Loader2, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { dispatchBusinessNumbersChanged } from "@/components/dashboard-numbers-modal-context"
import { useToast } from "@/hooks/use-toast"

type AvailableLine = {
  number: string
  display: string
  type: string
}

const DEMO_BY_AREA: Record<string, AvailableLine[]> = {
  "502": [
    { number: "+15025550142", display: "(502) 555-0142", type: "local" },
    { number: "+15025550198", display: "(502) 555-0198", type: "local" },
    { number: "+15025550176", display: "(502) 555-0176", type: "local" },
  ],
}

function demoLinesForArea(area: string): AvailableLine[] {
  const key = area.replace(/\D/g, "").slice(0, 3)
  if (DEMO_BY_AREA[key]) return DEMO_BY_AREA[key]
  const ac = key.padStart(3, "5").slice(0, 3)
  return [
    { number: `+1${ac}5550101`, display: `(${ac}) 555-0101`, type: "local" },
    { number: `+1${ac}5550102`, display: `(${ac}) 555-0102`, type: "local" },
    { number: `+1${ac}5550103`, display: `(${ac}) 555-0103`, type: "local" },
  ]
}

export function BuyNumberMarketplaceModal({
  open,
  onOpenChange,
  onOpenManage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenManage?: () => void
}) {
  const { toast } = useToast()
  const [areaCode, setAreaCode] = useState("502")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<AvailableLine[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [purchasing, setPurchasing] = useState<string | null>(null)
  const [lineLabel, setLineLabel] = useState("Main Line")

  useEffect(() => {
    if (!open) return
    setAreaCode("502")
    setResults([])
    setHasSearched(false)
    setPurchasing(null)
    setLineLabel("Main Line")
  }, [open])

  const runSearch = useCallback(async () => {
    const ac = areaCode.replace(/\D/g, "").slice(0, 3)
    if (ac.length < 3) return
    setSearching(true)
    setHasSearched(false)
    try {
      const res = await fetch(`/api/numbers/telnyx?area_code=${ac}&type=local`, { credentials: "include" })
      const data = (await res.json().catch(() => ({}))) as {
        numbers?: { number: string; type?: string }[]
      }
      const fromApi = Array.isArray(data.numbers)
        ? data.numbers.slice(0, 3).map((n) => ({
            number: String(n.number),
            display: formatPhoneDisplay(String(n.number)),
            type: String(n.type ?? "local"),
          }))
        : []
      setResults(fromApi.length > 0 ? fromApi : demoLinesForArea(ac))
    } catch {
      setResults(demoLinesForArea(ac))
    } finally {
      setSearching(false)
      setHasSearched(true)
    }
  }, [areaCode])

  async function purchaseLine(line: AvailableLine) {
    setPurchasing(line.number)
    try {
      const res = await fetch("/api/numbers/telnyx/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phone_number: line.number,
          line_business_name: lineLabel.trim() || "Main Line",
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(data.error || "Purchase failed")
      }
      toast({
        title: "Line purchased",
        description: `${line.display} is provisioning on your account.`,
      })
      dispatchBusinessNumbersChanged()
      onOpenChange(false)
    } catch (e) {
      toast({
        title: "Could not purchase",
        description: e instanceof Error ? e.message : "Try again or contact support.",
        variant: "destructive",
      })
    } finally {
      setPurchasing(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          "sigo-marketplace-dialog gap-0 overflow-hidden border-border/60 p-0 sm:max-w-lg",
          "transform-gpu will-change-transform backface-hidden"
        )}
      >
        <DialogHeader className="border-b border-border/60 px-6 py-5 text-left">
          <DialogTitle className="text-xl font-semibold tracking-tight">Buy a number</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Search inventory by area code and activate a line instantly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Line label (whisper)
            </label>
            <input
              type="text"
              value={lineLabel}
              onChange={(e) => setLineLabel(e.target.value)}
              maxLength={120}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              placeholder="e.g. Main Line"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Area code
              </span>
              <div className="relative">
                <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="502"
                  value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 py-2.5 pl-10 pr-3 text-sm font-semibold text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
            </label>
            <button
              type="button"
              disabled={areaCode.replace(/\D/g, "").length < 3 || searching}
              onClick={() => void runSearch()}
              className="inline-flex h-[42px] shrink-0 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[var(--electric-glow)] transition-[opacity,transform] hover:bg-primary/90 disabled:opacity-40"
            >
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search Available Lines"}
            </button>
          </div>

          {hasSearched ? (
            <ul className="sigo-bloom-in-stagger max-h-[min(50vh,22rem)] space-y-3 overflow-y-auto overscroll-contain pr-1">
              {results.map((line) => (
                <li
                  key={line.number}
                  className="transform-gpu will-change-[opacity,transform] rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold tabular-nums text-foreground">{line.display}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                          <Zap className="h-3 w-3" aria-hidden />
                          Instant Activation
                        </span>
                        <span className="text-xs font-medium text-zinc-400">$2.00 / mo</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={purchasing != null}
                      onClick={() => void purchaseLine(line)}
                      className="shrink-0 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-[var(--electric-glow)] transition-[opacity,transform] hover:bg-primary/90 disabled:opacity-50"
                    >
                      {purchasing === line.number ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Purchase Line"
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-500">
              Enter an area code and search to see available lines.
            </p>
          )}
        </div>

        {onOpenManage ? (
          <div className="border-t border-border/60 px-6 py-3 text-center">
            <button
              type="button"
              onClick={onOpenManage}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Manage existing lines
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
