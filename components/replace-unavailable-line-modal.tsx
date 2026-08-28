"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Hash, Loader2, RefreshCw } from "lucide-react"
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
import { useToast } from "@/hooks/use-toast"

type AvailableLine = {
  number: string
  display: string
}

async function fetchTelnyxLines(areaCode: string, limit: number): Promise<AvailableLine[]> {
  const res = await fetch(`/api/numbers/telnyx?area_code=${areaCode}&type=local`, { credentials: "include" })
  const data = (await res.json().catch(() => ({}))) as { numbers?: { number: string }[] }
  if (!Array.isArray(data.numbers)) return []
  return data.numbers.slice(0, limit).map((n) => ({
    number: String(n.number),
    display: formatPhoneDisplay(String(n.number)),
  }))
}

export function ReplaceUnavailableLineModal({
  open,
  onOpenChange,
  unavailableDisplay,
  areaCode: initialAreaCode,
  onConfirmLine,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  unavailableDisplay: string
  areaCode: string
  onConfirmLine: (line: AvailableLine) => Promise<void>
}) {
  const { toast } = useToast()
  const [areaCode, setAreaCode] = useState(initialAreaCode || "502")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<AvailableLine[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)
  const searchSeqRef = useRef(0)

  const runSearch = useCallback(async () => {
    const ac = areaCode.replace(/\D/g, "").slice(0, 3)
    if (ac.length < 3) return
    const seq = ++searchSeqRef.current
    setSearching(true)
    setResults([])
    try {
      const lines = await fetchTelnyxLines(ac, 12)
      if (seq !== searchSeqRef.current) return
      setResults(lines)
    } catch {
      if (seq !== searchSeqRef.current) return
      setResults([])
    } finally {
      if (seq === searchSeqRef.current) setSearching(false)
    }
  }, [areaCode])

  useEffect(() => {
    if (!open) return
    setAreaCode(initialAreaCode || "502")
    setResults([])
    setConfirming(null)
  }, [open, initialAreaCode])

  useEffect(() => {
    if (!open) return
    void runSearch()
  }, [open, runSearch])

  async function handlePick(line: AvailableLine) {
    setConfirming(line.number)
    try {
      await onConfirmLine(line)
      onOpenChange(false)
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not activate line",
        description: e instanceof Error ? e.message : "Try another number.",
      })
    } finally {
      setConfirming(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pick a new business number</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{unavailableDisplay}</span> is no longer available from
            the carrier. Choose a replacement below — you are only charged the $2.00 line fee after a number is
            successfully purchased.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            submitFormEvent(e)
            void runSearch()
          }}
        >
          <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Area code
            <span className="relative">
              <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
                className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm font-semibold tabular-nums"
                inputMode="numeric"
                maxLength={3}
                aria-label="Area code"
              />
            </span>
          </label>
          <button
            type="submit"
            disabled={searching || areaCode.replace(/\D/g, "").length < 3}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted/40 disabled:opacity-50"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Search
          </button>
        </form>

        <ul className="mt-2 space-y-2">
          {searching ? (
            <li className="py-8 text-center text-sm text-muted-foreground">Searching carrier inventory…</li>
          ) : results.length === 0 ? (
            <li className="py-8 text-center text-sm text-muted-foreground">
              No lines in this area code right now. Try a nearby area code.
            </li>
          ) : (
            results.map((line) => (
              <li
                key={line.number}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/80 p-4"
              >
                <span className="text-base font-semibold tabular-nums">{line.display}</span>
                <button
                  type="button"
                  disabled={confirming != null}
                  onClick={() => void handlePick(line)}
                  className={cn(
                    "rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground",
                    "hover:bg-primary/90 disabled:opacity-50"
                  )}
                >
                  {confirming === line.number ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Use this number"
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
