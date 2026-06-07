"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, MapPin } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { workspaceFieldClass } from "@/components/dashboard-workspace-ui"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import { notifyCarrierRegistrationUpdated } from "@/lib/settings-modals-events"
import { useToast } from "@/hooks/use-toast"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Address-only form for number porting — not the full 10DLC carrier review flow. */
export function PortServiceAddressModal({ open, onOpenChange }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [legalName, setLegalName] = useState("")
  const [street, setStreet] = useState("")
  const [city, setCity] = useState("")
  const [stateCode, setStateCode] = useState("")
  const [postal, setPostal] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const orgId = readActiveOrganizationId()
    const qs = orgId ? `?organization_id=${encodeURIComponent(orgId)}` : ""
    try {
      const res = await fetch(`/api/numbers/port/service-address${qs}`, { credentials: "include" })
      const json = await res.json().catch(() => ({}))
      const data = json?.data
      if (data) {
        setLegalName(String(data.legal_business_name ?? ""))
        setStreet(String(data.street ?? ""))
        setCity(String(data.city ?? ""))
        setStateCode(String(data.state ?? ""))
        setPostal(String(data.postal_code ?? ""))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch("/api/numbers/port/service-address", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: readActiveOrganizationId(),
          legal_business_name: legalName,
          street,
          city,
          state: stateCode,
          postal_code: postal,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Could not save address")
      toast({
        title: "Address saved",
        description: "Your port request can use this service address now.",
      })
      notifyCarrierRegistrationUpdated()
      onOpenChange(false)
    } catch (err) {
      toast({
        title: "Could not save address",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border/80 bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-violet-400" aria-hidden />
            Business service address
          </DialogTitle>
          <DialogDescription>
            Carriers require the address on your bill before they will port a number. This is separate from SMS
            carrier registration — you are only saving your address for this transfer.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading saved address…
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Legal business name
              </span>
              <input
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Key Squad Locksmith LLC"
                className={workspaceFieldClass}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Street</span>
              <input required value={street} onChange={(e) => setStreet(e.target.value)} className={workspaceFieldClass} />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1.5 sm:col-span-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">City</span>
                <input required value={city} onChange={(e) => setCity(e.target.value)} className={workspaceFieldClass} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">State</span>
                <input
                  required
                  maxLength={2}
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value.toUpperCase())}
                  placeholder="KY"
                  className={workspaceFieldClass}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">ZIP</span>
                <input
                  required
                  value={postal}
                  onChange={(e) => setPostal(e.target.value)}
                  placeholder="40202"
                  className={workspaceFieldClass}
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Save address & continue port
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
