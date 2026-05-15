"use client"

// ============================================
// AnsweredCallCustomerPopup
// ============================================
// Polls recent answered inbound calls; opens a sheet so the owner can capture caller details.
// Debounced PUT /api/customers upserts into the searchable Customers list.

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronDown, Phone } from "lucide-react"
import type { Customer } from "@/lib/types"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

const SEEN_KEY = "zing_answered_customer_popup_seen_v1"

function loadSeen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

function persistSeen(s: Set<string>) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-100)))
  } catch {
    /* ignore quota */
  }
}

type AnsweredRow = {
  id: string
  from_number: string
  to_number: string
  caller_name: string | null
  answered_at: string | null
}

export function AnsweredCallCustomerPopup({ enabled }: { enabled: boolean }) {
  const seenRef = useRef(loadSeen())
  const [current, setCurrent] = useState<AnsweredRow | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [displayName, setDisplayName] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [addressLine1, setAddressLine1] = useState("")
  const [addressLine2, setAddressLine2] = useState("")
  const [city, setCity] = useState("")
  const [region, setRegion] = useState("")
  const [postalCode, setPostalCode] = useState("")
  const [country, setCountry] = useState("US")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const tick = () => {
      fetch("/api/calls/answered-recent", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { calls: [] }))
        .then((data: { calls?: AnsweredRow[] }) => {
          if (cancelled) return
          const calls = Array.isArray(data.calls) ? data.calls : []
          setCurrent((prev) => {
            if (prev) return prev
            const sorted = [...calls].sort(
              (a, b) => new Date(a.answered_at || 0).getTime() - new Date(b.answered_at || 0).getTime()
            )
            for (const row of sorted) {
              if (!seenRef.current.has(row.id)) return row
            }
            return null
          })
        })
        .catch(() => {})
    }
    tick()
    const id = window.setInterval(tick, 7000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) setCurrent(null)
  }, [enabled])

  useEffect(() => {
    if (!current) return
    let cancel = false
    setMoreOpen(false)
    setSaveState("idle")
    setDisplayName(current.caller_name?.trim() || "")
    setCompanyName("")
    setAddressLine1("")
    setAddressLine2("")
    setCity("")
    setRegion("")
    setPostalCode("")
    setCountry("US")
    setNotes("")
    const q = encodeURIComponent(current.from_number)
    fetch(`/api/customers?phone=${q}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { customers: [] }))
      .then((data: { customers?: Customer[] }) => {
        if (cancel) return
        const c = data.customers?.[0]
        if (!c) return
        setDisplayName(c.display_name || "")
        setCompanyName(c.company_name || "")
        setAddressLine1(c.address_line1 || "")
        setAddressLine2(c.address_line2 || "")
        setCity(c.city || "")
        setRegion(c.region || "")
        setPostalCode(c.postal_code || "")
        setCountry(c.country || "US")
        setNotes(c.notes || "")
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [current])

  useEffect(() => {
    if (!current) return
    setSaveState("idle")
    const t = window.setTimeout(() => {
      setSaveState("saving")
      fetch("/api/customers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phone_e164: current.from_number,
          display_name: displayName,
          company_name: companyName,
          address_line1: addressLine1,
          address_line2: addressLine2,
          city,
          region,
          postal_code: postalCode,
          country,
          notes,
          source_last_call_log_id: current.id,
        }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error("save")
          return res.json()
        })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"))
    }, 1000)
    return () => window.clearTimeout(t)
  }, [
    current,
    displayName,
    companyName,
    addressLine1,
    addressLine2,
    city,
    region,
    postalCode,
    country,
    notes,
  ])

  const closeAndAdvance = useCallback(() => {
    setCurrent((prev) => {
      if (!prev) return prev
      seenRef.current.add(prev.id)
      persistSeen(seenRef.current)
      const prevId = prev.id
      queueMicrotask(() => {
        void fetch("/api/calls/answered-recent", { credentials: "include" })
          .then((r) => (r.ok ? r.json() : { calls: [] }))
          .then((data: { calls?: AnsweredRow[] }) => {
            const calls = Array.isArray(data.calls) ? data.calls : []
            const sorted = [...calls].sort(
              (a, b) => new Date(a.answered_at || 0).getTime() - new Date(b.answered_at || 0).getTime()
            )
            for (const row of sorted) {
              if (row.id === prevId) continue
              if (!seenRef.current.has(row.id)) {
                setCurrent(row)
                return
              }
            }
          })
      })
      return null
    })
  }, [])

  if (!enabled) return null

  return (
    <Sheet
      open={current != null}
      onOpenChange={(o) => {
        if (!o) closeAndAdvance()
      }}
    >
      <SheetContent side="bottom" className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3">
        {current ? (
          <>
            <SheetHeader className="border-b border-border/60 px-4 pb-3 pt-2 text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Call answered</p>
              <SheetTitle className="flex items-center gap-2 text-left text-lg">
                <Phone className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                {formatPhoneDisplay(current.from_number)}
              </SheetTitle>
              <p className="text-left text-xs text-muted-foreground">
                Line {formatPhoneDisplay(current.to_number)} · details save automatically to your customer list.
              </p>
            </SheetHeader>

            <div className="max-h-[min(70vh,520px)] space-y-3 overflow-y-auto px-4 py-3">
              <div className="space-y-1.5">
                <Label htmlFor="ac-display" className="text-xs">
                  Name
                </Label>
                <Input
                  id="ac-display"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Caller name"
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ac-company" className="text-xs">
                  Company
                </Label>
                <Input
                  id="ac-company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Optional"
                  className="h-10"
                />
              </div>

              <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-left text-xs font-semibold text-foreground"
                  >
                    Address &amp; more
                    <ChevronDown className={cn("h-4 w-4 transition-transform", moreOpen && "rotate-180")} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3 data-[state=closed]:animate-none">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Street</Label>
                    <Input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} className="h-10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Apt / suite</Label>
                    <Input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} className="h-10" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">City</Label>
                      <Input value={city} onChange={(e) => setCity(e.target.value)} className="h-10" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">State / region</Label>
                      <Input value={region} onChange={(e) => setRegion(e.target.value)} className="h-10" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Postal code</Label>
                      <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="h-10" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Country</Label>
                      <Input value={country} onChange={(e) => setCountry(e.target.value)} className="h-10" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Notes</Label>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Tags, follow-up…" className="h-10" />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

            <SheetFooter className="flex flex-col gap-2 border-t border-border/70 bg-secondary/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-muted-foreground">
                {saveState === "saving" ? "Saving…" : null}
                {saveState === "saved" ? "Saved to Customers." : null}
                {saveState === "error" ? "Save failed — check migration 022." : null}
                {saveState === "idle" ? "Edits save automatically." : null}{" "}
                <Link href="/dashboard/customers" className="font-semibold text-primary underline-offset-2 hover:underline">
                  Open customer list
                </Link>
              </p>
              <Button type="button" variant="secondary" size="sm" onClick={() => closeAndAdvance()}>
                Dismiss
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
