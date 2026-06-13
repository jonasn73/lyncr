"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Hash, Loader2, Zap } from "lucide-react"
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
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import { PortNumberModal } from "@/components/dashboard/port-number-modal"
import { useToast } from "@/hooks/use-toast"
import { showUpgradeSubscriptionModal } from "@/components/upgrade-subscription-modal"

type AvailableLine = {
  number: string
  display: string
  type: string
}

type SearchMeta = {
  page: number
  page_size: number
  total_results: number
  total_pages: number
  has_more: boolean
}

const SEARCH_PULSE_MS = 480

function normalizeAreaCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 3)
}

function mergeUniqueLines(existing: AvailableLine[], incoming: AvailableLine[]): AvailableLine[] {
  const seen = new Set(existing.map((row) => row.number))
  const merged = [...existing]
  for (const row of incoming) {
    if (seen.has(row.number)) continue
    seen.add(row.number)
    merged.push(row)
  }
  return merged
}

/** Live Telnyx inventory only — never pad with fake numbers. */
async function fetchTelnyxLines(
  areaCode: string,
  opts?: { endsWith?: string; contains?: string; page?: number }
): Promise<{ lines: AvailableLine[]; meta: SearchMeta | null }> {
  const qs = new URLSearchParams({ area_code: areaCode, type: "local" })
  const ends = (opts?.endsWith || "").replace(/\D/g, "").slice(-4)
  const contains = (opts?.contains || "").replace(/\D/g, "").slice(-4)
  if (ends.length >= 2) qs.set("ends_with", ends)
  else if (contains.length >= 2) qs.set("contains", contains)
  if (opts?.page && opts.page > 1) qs.set("page", String(opts.page))

  const res = await fetch(`/api/numbers/telnyx?${qs.toString()}`, { credentials: "include" })
  const data = (await res.json().catch(() => ({}))) as {
    numbers?: { number: string; type?: string }[]
    meta?: Partial<SearchMeta>
    error?: string
  }
  if (!res.ok) {
    throw new Error(data.error || "Could not search Telnyx inventory")
  }
  if (!Array.isArray(data.numbers)) return { lines: [], meta: data.meta as SearchMeta | null }
  const lines = data.numbers.map((n) => ({
    number: String(n.number),
    display: formatPhoneDisplay(String(n.number)),
    type: String(n.type ?? "local"),
  }))
  const meta = data.meta
    ? {
        page: Number(data.meta.page ?? opts?.page ?? 1),
        page_size: Number(data.meta.page_size ?? lines.length),
        total_results: Number(data.meta.total_results ?? lines.length),
        total_pages: Number(data.meta.total_pages ?? (lines.length > 0 ? 1 : 0)),
        has_more: Boolean(data.meta.has_more),
      }
    : null
  return { lines, meta }
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
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [purchasing, setPurchasing] = useState<string | null>(null)
  const [lineLabel, setLineLabel] = useState("Main Line")
  const [lastFourDigits, setLastFourDigits] = useState("")
  const [entitlementsBlocked, setEntitlementsBlocked] = useState<string | null>(null)
  const [panelView, setPanelView] = useState<"marketplace" | "port">("marketplace")
  const searchSeqRef = useRef(0)

  const results = inventoryPool

  useEffect(() => {
    if (!open) return
    setAreaCode("502")
    setActiveAreaCode(null)
    setInventoryPool([])
    setSearchMeta(null)
    setHasSearched(false)
    setSearchError(null)
    setSearching(false)
    setLoadingMore(false)
    setPurchasing(null)
    setLineLabel("Main Line")
    setLastFourDigits("")
    setPanelView("marketplace")
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
    setSearchMeta(null)
    setHasSearched(true)
    setSearchError(null)
    setSearching(true)
    setActiveAreaCode(null)

    await new Promise((r) => setTimeout(r, SEARCH_PULSE_MS))
    if (seq !== searchSeqRef.current) return

    try {
      const pattern = lastFourDigits.replace(/\D/g, "").slice(-4)
      const { lines, meta } = await fetchTelnyxLines(ac, {
        endsWith: pattern.length >= 2 ? pattern : undefined,
        page: 1,
      })
      if (seq !== searchSeqRef.current) return
      setInventoryPool(lines)
      setSearchMeta(meta)
      setActiveAreaCode(ac)
    } catch (e) {
      if (seq !== searchSeqRef.current) return
      setSearchError(e instanceof Error ? e.message : "Search failed")
      setActiveAreaCode(ac)
    } finally {
      if (seq === searchSeqRef.current) setSearching(false)
    }
  }, [areaCode, lastFourDigits])

  const loadMoreNumbers = useCallback(async () => {
    const ac = activeAreaCode ?? normalizeAreaCode(areaCode)
    if (ac.length < 3 || searching || loadingMore || !searchMeta?.has_more) return

    setLoadingMore(true)
    try {
      const pattern = lastFourDigits.replace(/\D/g, "").slice(-4)
      const nextPage = (searchMeta?.page ?? 1) + 1
      const { lines, meta } = await fetchTelnyxLines(ac, {
        endsWith: pattern.length >= 2 ? pattern : undefined,
        page: nextPage,
      })
      setInventoryPool((prev) => mergeUniqueLines(prev, lines))
      setSearchMeta(meta)
      setSearchError(null)
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not load more",
        description: e instanceof Error ? e.message : "Try again in a moment.",
      })
    } finally {
      setLoadingMore(false)
    }
  }, [activeAreaCode, areaCode, searching, loadingMore, searchMeta, lastFourDigits, toast])

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
          organization_id: readActiveOrganizationId(),
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
          setSearchMeta((prev) =>
            prev
              ? {
                  ...prev,
                  total_results: Math.max(0, prev.total_results - 1),
                }
              : prev
          )
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
    activeAreaCode != null &&
    searchMeta?.has_more

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          "sigo-marketplace-dialog flex max-h-[min(92dvh,720px)] flex-col gap-0 overflow-hidden border-border/60 p-0 sm:max-w-lg",
          "transform-gpu will-change-transform backface-hidden"
        )}
      >
        {panelView === "port" ? (
          <PortNumberModal
            embedded
            onBack={() => setPanelView("marketplace")}
            onSubmitted={() => {
              dispatchBusinessNumbersChanged()
              onOpenChange(false)
            }}
          />
        ) : (
          <>
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

            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Last 4 digits (optional)
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="0194"
                value={lastFourDigits}
                onChange={(e) => setLastFourDigits(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <p className="text-xs leading-relaxed text-zinc-500">
                Match numbers ending in these digits within the area code.{" "}
                <span className="text-zinc-400">
                  (502) 555-0194 is a reserved movie/TV number — real carriers cannot sell 555-01xx lines.
                </span>{" "}
                Try last four <span className="font-medium text-zinc-300">0194</span> in area code{" "}
                <span className="font-medium text-zinc-300">502</span> instead.
              </p>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
            <div
              className={cn(
                "max-h-[min(52dvh,520px)] min-h-[12rem] overflow-y-auto overscroll-contain pr-1",
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
                  {lastFourDigits.replace(/\D/g, "").length >= 2
                    ? `No 502 lines ending in ${lastFourDigits.replace(/\D/g, "").slice(-4)} right now. Clear the last-4 filter and search again, or try 859 / 606 / 270.`
                    : `No lines available in ${activeAreaCode ?? normalizeAreaCode(areaCode)} right now. Try a nearby area code (859, 606, 270) or search again in a few minutes.`}
                </p>
              ) : (
                <div className="p-3">
                  {searchMeta && searchMeta.total_results > 0 ? (
                    <p className="mb-3 px-1 text-xs text-zinc-500">
                      Showing {results.length}
                      {searchMeta.total_results > results.length
                        ? ` of ${searchMeta.total_results}+`
                        : ""}{" "}
                      available {activeAreaCode ?? normalizeAreaCode(areaCode)} lines
                    </p>
                  ) : null}
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
                        ) : null}
                        {loadingMore ? "Loading more…" : "Load more numbers"}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 space-y-2 border-t border-border/60 px-6 py-3 text-center">
          <button
            type="button"
            onClick={() => setPanelView("port")}
            className="block w-full text-xs font-semibold text-violet-400 hover:text-violet-300 hover:underline"
          >
            Port your existing number to Lyncr
          </button>
          {onOpenManage ? (
            <button
              type="button"
              onClick={onOpenManage}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Manage existing lines
            </button>
          ) : null}
        </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
