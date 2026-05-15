"use client"

// ============================================
// CustomersPage — searchable saved callers (CRM-lite)
// ============================================
// Tap a row to open an editable sheet; changes debounce-save to PUT /api/customers.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { BookUser, ChevronDown, Loader2, Search } from "lucide-react"
import type { Customer } from "@/lib/types"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { IconSurface } from "@/components/ui/icon-surface"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

export function CustomersPage() {
  const [q, setQ] = useState("")
  const [debounced, setDebounced] = useState("")
  const [rows, setRows] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<Customer | null>(null)
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
    const t = window.setTimeout(() => setDebounced(q.trim()), 320)
    return () => window.clearTimeout(t)
  }, [q])

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (debounced) params.set("q", debounced)
    fetch(`/api/customers?${params.toString()}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || "Could not load")
        }
        return res.json()
      })
      .then((data: { customers?: Customer[] }) => {
        setRows(Array.isArray(data.customers) ? data.customers : [])
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false))
  }, [debounced])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!detail) return
    setMoreOpen(false)
    setSaveState("idle")
    setDisplayName(detail.display_name || "")
    setCompanyName(detail.company_name || "")
    setAddressLine1(detail.address_line1 || "")
    setAddressLine2(detail.address_line2 || "")
    setCity(detail.city || "")
    setRegion(detail.region || "")
    setPostalCode(detail.postal_code || "")
    setCountry(detail.country || "US")
    setNotes(detail.notes || "")
  }, [detail])

  useEffect(() => {
    if (!detail) return
    setSaveState("idle")
    const t = window.setTimeout(() => {
      setSaveState("saving")
      fetch("/api/customers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phone_e164: detail.phone_e164,
          display_name: displayName,
          company_name: companyName,
          address_line1: addressLine1,
          address_line2: addressLine2,
          city,
          region,
          postal_code: postalCode,
          country,
          notes,
        }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error("save")
          return res.json() as Promise<{ data?: Customer }>
        })
        .then((out) => {
          setSaveState("saved")
          if (out.data) {
            setDetail(out.data)
            setRows((prev) => prev.map((r) => (r.id === out.data!.id ? out.data! : r)))
          } else {
            void load()
          }
        })
        .catch(() => setSaveState("error"))
    }, 900)
    return () => window.clearTimeout(t)
  }, [detail, displayName, companyName, addressLine1, addressLine2, city, region, postalCode, country, notes])

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-6">
      <div className="flex items-center gap-3">
        <IconSurface tone="primary">
          <BookUser className="h-5 w-5" />
        </IconSurface>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Customers</h1>
          <p className="text-xs text-muted-foreground">
            Search by name, phone, or address. Tap a row to edit — changes save automatically after you pause typing.
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search customers…"
          className="h-11 pl-10"
          aria-label="Search customers"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-border/70 bg-card/80 p-4 text-sm text-muted-foreground">
          No customers yet. After you run <span className="font-mono text-[11px]">022-customers.sql</span> in Neon, use the
          answered-call sheet or add records here once you have a saved profile.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setDetail(c)}
                className="w-full rounded-2xl border border-border/70 bg-card/85 p-4 text-left shadow-sm transition-colors hover:border-primary/35 hover:bg-card"
              >
                <p className="text-sm font-semibold text-foreground">{c.display_name || "Unnamed caller"}</p>
                <p className="text-xs text-muted-foreground">{formatPhoneDisplay(c.phone_e164)}</p>
                {c.company_name ? <p className="mt-1 text-[11px] text-muted-foreground">{c.company_name}</p> : null}
                {c.city || c.region ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {[c.city, c.region].filter(Boolean).join(", ")}
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-[11px] text-muted-foreground">
        <Link href="/dashboard/settings#answered-call-customers" className="font-semibold text-primary underline-offset-2 hover:underline">
          Popup settings
        </Link>
        {" · "}
        <Link href="/dashboard" className="font-semibold text-primary underline-offset-2 hover:underline">
          Routing
        </Link>
      </p>

      <Sheet open={detail != null} onOpenChange={(o) => !o && setDetail(null)} modal>
        <SheetContent side="bottom" className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3">
          {detail ? (
            <>
              <SheetHeader className="border-b border-border/60 px-4 pb-3 pt-2 text-left">
                <SheetTitle className="text-left">Edit customer</SheetTitle>
                <p className="text-left text-xs text-muted-foreground">
                  {formatPhoneDisplay(detail.phone_e164)} · phone number is the record key
                </p>
              </SheetHeader>

              <div className="max-h-[min(70vh,520px)] space-y-3 overflow-y-auto px-4 py-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cust-name" className="text-xs">
                    Name
                  </Label>
                  <Input
                    id="cust-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="h-10"
                    placeholder="Display name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cust-co" className="text-xs">
                    Company
                  </Label>
                  <Input
                    id="cust-co"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="h-10"
                    placeholder="Optional"
                  />
                </div>

                <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-left text-xs font-semibold text-foreground"
                    >
                      Address &amp; notes
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
                      <Label htmlFor="cust-notes" className="text-xs">
                        Notes
                      </Label>
                      <Input
                        id="cust-notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Follow-ups, tags…"
                        className="h-10"
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              <SheetFooter className="flex flex-col gap-1 border-t border-border/70 bg-secondary/15 px-4 py-3">
                <p className="text-[11px] text-muted-foreground">
                  {saveState === "saving" ? "Saving…" : null}
                  {saveState === "saved" ? "Saved." : null}
                  {saveState === "error" ? "Save failed — run 022-customers.sql if the table is missing." : null}
                  {saveState === "idle" ? "Edits save automatically after a short pause." : null}
                </p>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
