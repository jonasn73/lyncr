"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Hash, Loader2, RefreshCw, Zap } from "lucide-react"
import { submitFormEvent } from "@/lib/form-keyboard"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { fetchNumberEntitlements } from "@/lib/number-entitlements-client"
import { dispatchBusinessNumbersChanged } from "@/components/dashboard-numbers-modal-context"
import { useToast } from "@/hooks/use-toast"
import { showUpgradeSubscriptionModal } from "@/components/upgrade-subscription-modal"

type AvailableLine = {
  number: string
  display: string
  type: string
}

const INITIAL_BATCH = 4
const LOAD_MORE_BATCH = 3
const SEARCH_PULSE_MS = 480
const TELNYX_SEARCH_LIMIT = 25

function normalizeAreaCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 3)
}

/** Live Telnyx inventory only — never pad with fake numbers. */
async function fetchTelnyxLines(areaCode: string): Promise<AvailableLine[]> {
  const res = await fetch(`/api/numbers/telnyx?area_code=${areaCode}&type=local`, { credentials: "include" })
  const data = (await res.json().catch(() => ({}))) as {
    numbers?: { number: string; type?: string }[]
    error?: string
  }
  if (!res.ok) {
    throw new Error(data.error || "Could not search Telnyx inventory")
  }
  if (!Array.isArray(data.numbers)) return []
  return data.numbers.slice(0, TELNYX_SEARCH_LIMIT).map((n) => ({
    number: String(n.number),
    display: formatPhoneDisplay(String(n.number)),
    type: String(n.type ?? "local"),
  }))
}

function InventoryRow({
  line,
  purchasing,
  purchaseDisabled,
  onPurchase,
}: {
  line: AvailableLine
  purchasing: string | null
  purchaseDisabled: boolean
  onPurchase: (line: AvailableLine) => void
}) {
  return (
    <li className="transform-gpu rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 will-change-[opacity,transform]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold tabular-nums text-foreground">{line.display}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              <Zap className="h-3 w-3" aria-hidden />
              Live Telnyx inventory
            </span>
            <span className="text-xs font-medium text-zinc-400">$2.00 / mo</span>
          </div>
        </div>
        <button
          type="button"
          disabled={purchasing != null || purchaseDisabled}
          onClick={() => onPurchase(line)}
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
  )
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
  const [activeAreaCode, setActiveAreaCode] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [inventoryPool, setInventoryPool] = useState<AvailableLine[]>([])
  const [visibleCount, setVisibleCount] = useState(0)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [purchasing, setPurchasing] = useState<string | null>(null)
  const [lineLabel, setLineLabel] = useState("Main Line")
  const [entitlementsBlocked, setEntitlementsBlocked] = useState<string | null>(null)
  const searchSeqRef = useRef(0)

  const results = useMemo(() => inventoryPool.slice(0, visibleCount), [inventoryPool, visibleCount])

  useEffect(() => {
    if (!open) return
    setAreaCode("502")
    setActiveAreaCode(null)
    setInventoryPool([])
    setVisibleCount(0)
    setHasSearched(false)
    setSearchError(null)
    setSearching(false)
    setLoadingMore(false)
    setPurchasing(null)
    setLineLabel("Main Line")
    setEntitlementsBlocked(null)
    void fetchNumberEntitlements()
      .then((data) => {
        if (!data.allowed) {
          setEntitlementsBlocked(data.message ?? "You cannot add another business number.")
        }
      })
      .catch(() => {
        setEntitlementsBlocked(null)
      })
  }, [open])

  const runSearch = useCallback(async () => {
    const ac = normalizeAreaCode(areaCode)
    if (ac.length < 3) return

    const seq = ++searchSeqRef.current
    setInventoryPool([])
    setVisibleCount(0)
    setHasSearched(true)
    setSearchError(null)
    setSearching(true)
    setActiveAreaCode(null)

    await new Promise((r) => setTimeout(r, SEARCH_PULSE_MS))
    if (seq !== searchSeqRef.current) return

    try {
      const fromApi = await fetchTelnyxLines(ac)
      if (seq !== searchSeqRef.current) return
      setInventoryPool(fromApi)
      setVisibleCount(Math.min(INITIAL_BATCH, fromApi.length))
      setActiveAreaCode(ac)
    } catch (e) {
      if (seq !== searchSeqRef.current) return
      setSearchError(e instanceof Error ? e.message : "Search failed")
      setActiveAreaCode(ac)
    } finally {
      if (seq === searchSeqRef.current) setSearching(false)
    }
  }, [areaCode])

  const loadMoreNumbers = useCallback(async () => {
    const ac = activeAreaCode ?? normalizeAreaCode(areaCode)
    if (ac.length < 3 || searching || loadingMore) return

    if (visibleCount < inventoryPool.length) {
      setVisibleCount((n) => Math.min(n + LOAD_MORE_BATCH, inventoryPool.length))
      return
    }

    setLoadingMore(true)
    try {
      const fresh = await fetchTelnyxLines(ac)
      setInventoryPool(fresh)
      setVisibleCount(Math.min(INITIAL_BATCH + LOAD_MORE_BATCH, fresh.length))
      setSearchError(null)
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Refresh failed",
        description: e instanceof Error ? e.message : "Try again in a moment.",
      })
    } finally {
      setLoadingMore(false)
    }
  }, [activeAreaCode, areaCode, searching, loadingMore, visibleCount, inventoryPool.length, toast])

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
      const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string }
      if (!res.ok) {
        if (res.status === 403 && data.reason === "tier_limit") {
          showUpgradeSubscriptionModal({ message: data.error })
        }
        if (
          data.reason === "number_unavailable" ||
          data.reason === "area_empty" ||
          /no longer available|not available/i.test(data.error || "")
        ) {
          setInventoryPool((prev) => prev.filter((row) => row.number !== line.number))
          setVisibleCount((n) => Math.max(0, Math.min(n, inventoryPool.length - 1)))
        }
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

  const showInventory = hasSearched
  const canLoadMore =
    showInventory &&
    !searching &&
    !searchError &&
    inventoryPool.length > 0 &&
    activeAreaCode != null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          "sigo-marketplace-dialog flex max-h-[min(92dvh,720px)] flex-col gap-0 overflow-hidden border-border/60 p-0 sm:max-w-lg",
          "transform-gpu will-change-transform backface-hidden"
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-5 text-left">
          <DialogTitle className="text-xl font-semibold tracking-tight">Buy a number</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Search live Telnyx inventory by area code — only real, purchasable lines are shown.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {entitlementsBlocked ? (
            <div className="mx-6 mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-4 text-sm text-destructive">
              {entitlementsBlocked}
            </div>
          ) : null}
          <div className="shrink-0 space-y-5 px-6 py-5">
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

            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                submitFormEvent(e)
                if (normalizeAreaCode(areaCode).length === 3 && !searching) void runSearch()
              }}
            >
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
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 py-2.5 pl-10 pr-3 text-sm font-semibold text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </label>
              <button
                type="submit"
                disabled={normalizeAreaCode(areaCode).length < 3 || searching || entitlementsBlocked != null}
                className="inline-flex h-[42px] shrink-0 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[var(--electric-glow)] transition-[opacity,transform] hover:bg-primary/90 disabled:opacity-40"
              >
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search Available Lines"}
              </button>
            </form>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
            <div
              className={cn(
                "max-h-[380px] min-h-[12rem] overflow-y-auto overscroll-contain pr-1",
                showInventory && "rounded-xl border border-zinc-800/80 bg-zinc-950/30"
              )}
            >
              {!showInventory ? (
                <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-500">
                  Enter an area code and search to see available lines.
                </p>
              ) : searching ? (
                <div className="flex flex-col items-center justify-center gap-3 px-4 py-16">
                  <div className="relative flex h-12 w-12 items-center justify-center">
                    <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" aria-hidden />
                    <Loader2 className="relative h-7 w-7 animate-spin text-primary" aria-hidden />
                  </div>
                  <p className="animate-pulse text-sm font-medium text-zinc-400">
                    Searching {normalizeAreaCode(areaCode)} inventory…
                  </p>
                </div>
              ) : searchError ? (
                <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-8 text-center text-sm text-destructive">
                  {searchError}
                </p>
              ) : results.length === 0 ? (
                <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-500">
                  No lines available in {activeAreaCode ?? normalizeAreaCode(areaCode)} right now. Try a nearby area
                  code (859, 606, 270) or search again in a few minutes.
                </p>
              ) : (
                <div className="p-3">
                  <ul className="space-y-3">
                    {results.map((line) => (
                      <InventoryRow
                        key={line.number}
                        line={line}
                        purchasing={purchasing}
                        purchaseDisabled={entitlementsBlocked != null}
                        onPurchase={purchaseLine}
                      />
                    ))}
                  </ul>

                  {canLoadMore ? (
                    <div className="mt-4 flex justify-center border-t border-zinc-800/80 pt-4">
                      <button
                        type="button"
                        disabled={loadingMore}
                        onClick={() => void loadMoreNumbers()}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-transparent px-4 py-2 text-xs font-semibold text-zinc-400",
                          "transition-[opacity,transform,border-color,color] duration-200",
                          "hover:scale-[1.02] hover:border-zinc-500 hover:text-zinc-200",
                          "active:scale-[0.98] disabled:opacity-50"
                        )}
                      >
                        {loadingMore ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {visibleCount < inventoryPool.length ? "Show more lines" : "Refresh inventory"}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>

        {onOpenManage ? (
          <div className="shrink-0 border-t border-border/60 px-6 py-3 text-center">
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
