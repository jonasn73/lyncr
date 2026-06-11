"use client"

// Admin porting control desk — timeline, carrier alerts, Telnyx correction form.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowRightLeft,
  FileUp,
  Loader2,
  MessageSquare,
  Send,
} from "lucide-react"
import type { AdminPortingDeskDetail, PortingOrder } from "@/lib/types"
import type { AdminPortingPipelineStep } from "@/lib/admin-porting-timeline"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { displayPortingMessageBody } from "@/lib/porting-display"

/** Read a PDF/image file as base64 for Telnyx document upload. */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? "")
      const base64 = result.includes(",") ? result.split(",")[1] ?? "" : result
      resolve(base64)
    }
    reader.onerror = () => reject(new Error("Could not read file"))
    reader.readAsDataURL(file)
  })
}

function pipelineDotClass(state: AdminPortingPipelineStep["state"]): string {
  if (state === "complete") return "bg-emerald-500 ring-emerald-500/30"
  if (state === "current") return "bg-sky-400 ring-sky-400/40 animate-pulse"
  if (state === "failed") return "bg-red-500 ring-red-500/40"
  return "bg-slate-600 ring-slate-600/30"
}

function commentAuthorLabel(userType: string): string {
  if (userType === "admin") return "Porting team"
  if (userType === "user") return "Customer"
  if (userType === "system") return "Carrier system"
  return userType
}

export function PortingControlDesk({ ownerUserId }: { ownerUserId: string }) {
  const [orders, setOrders] = useState<PortingOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminPortingDeskDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [accountNumber, setAccountNumber] = useState("")
  const [pin, setPin] = useState("")
  const [streetAddress, setStreetAddress] = useState("")
  const [city, setCity] = useState("")
  const [stateRegion, setStateRegion] = useState("")
  const [postalCode, setPostalCode] = useState("")
  const [entityName, setEntityName] = useState("")
  const [authorizedPerson, setAuthorizedPerson] = useState("")
  const [carrierComment, setCarrierComment] = useState("")
  const [loaFile, setLoaFile] = useState<File | null>(null)
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true)
    try {
      const res = await fetch(`/api/admin/porting?owner_user_id=${encodeURIComponent(ownerUserId)}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json().catch(() => ({}))) as { data?: { orders: PortingOrder[] }; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not load porting orders")
      const list = json.data?.orders ?? []
      setOrders(list)
      setSelectedId((prev) => prev ?? list[0]?.id ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load porting orders")
      setOrders([])
    } finally {
      setOrdersLoading(false)
    }
  }, [ownerUserId])

  const loadDetail = useCallback(async (orderId: string) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/porting/${encodeURIComponent(orderId)}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json().catch(() => ({}))) as { data?: AdminPortingDeskDetail; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not load porting detail")
      const d = json.data ?? null
      setDetail(d)
      if (d?.order) {
        setAccountNumber(d.order.account_number ?? "")
        setPin(d.order.pin_or_sid ?? "")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load porting detail")
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOrders()
  }, [loadOrders])

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
    else setDetail(null)
  }, [selectedId, loadDetail])

  async function submitCorrections() {
    if (!selectedId) return
    setSubmitting(true)
    try {
      let loa_base64: string | undefined
      let loa_filename: string | undefined
      let invoice_base64: string | undefined
      let invoice_filename: string | undefined
      if (loaFile) {
        loa_base64 = await fileToBase64(loaFile)
        loa_filename = loaFile.name
      }
      if (invoiceFile) {
        invoice_base64 = await fileToBase64(invoiceFile)
        invoice_filename = invoiceFile.name
      }

      const res = await fetch(`/api/admin/porting/${encodeURIComponent(selectedId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_number: accountNumber.trim() || undefined,
          pin: pin.trim() || undefined,
          street_address: streetAddress.trim() || undefined,
          city: city.trim() || undefined,
          state: stateRegion.trim() || undefined,
          postal_code: postalCode.trim() || undefined,
          entity_name: entityName.trim() || undefined,
          authorized_person: authorizedPerson.trim() || undefined,
          carrier_comment: carrierComment.trim() || undefined,
          loa_base64,
          loa_filename,
          invoice_base64,
          invoice_filename,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: { ok: boolean; detail?: AdminPortingDeskDetail }
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "Submit failed")
      if (json.data?.detail) setDetail(json.data.detail)
      setCarrierComment("")
      setLoaFile(null)
      setInvoiceFile(null)
      toast.success("Corrections submitted to Telnyx")
      await loadOrders()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit corrections")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="h-4 w-4 text-orange-300" aria-hidden />
        <Label className="text-slate-200">Porting control desk</Label>
      </div>

      {ordersLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading transfers…
        </div>
      ) : orders.length === 0 ? (
        <p className="text-xs text-slate-500">No porting orders for this business owner.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Transfer request</Label>
            <select
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value || null)}
            >
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.phone_number} · {o.status}
                  {o.telnyx_status ? ` (${o.telnyx_status})` : ""}
                </option>
              ))}
            </select>
          </div>

          {detailLoading && !detail ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading transfer detail…
            </div>
          ) : detail ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-slate-700 bg-slate-900 text-slate-200">{detail.order.status}</Badge>
                {detail.telnyx_live_status ? (
                  <Badge className="border-orange-800/60 bg-orange-950/40 text-orange-200">
                    Telnyx · {detail.telnyx_status_label}
                  </Badge>
                ) : null}
                {detail.order.telnyx_order_id ? (
                  <span className="font-mono text-[10px] text-slate-500">{detail.order.telnyx_order_id}</span>
                ) : null}
              </div>

              {detail.action_alerts.length > 0 ? (
                <div className="space-y-2">
                  {detail.action_alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-100"
                      role="alert"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                        <div>
                          <p className="font-medium">{alert.title}</p>
                          <p className="mt-0.5 whitespace-pre-wrap text-amber-100/90">
                            {displayPortingMessageBody(alert.body)}
                          </p>
                          <p className="mt-1 text-[10px] text-amber-200/60">
                            {new Date(alert.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-300">Transfer journey</p>
                <ol className="relative ml-2 border-l border-slate-800 pl-4">
                  {detail.pipeline_steps.map((step) => (
                    <li key={step.key} className="mb-3 last:mb-0">
                      <span
                        className={cn(
                          "absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full ring-2",
                          pipelineDotClass(step.state)
                        )}
                        aria-hidden
                      />
                      <p
                        className={cn(
                          "text-xs font-medium",
                          step.state === "current" && "text-sky-300",
                          step.state === "complete" && "text-emerald-300/90",
                          step.state === "failed" && "text-red-300",
                          step.state === "upcoming" && "text-slate-500"
                        )}
                      >
                        {step.label}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>

              {(detail.notifications.length > 0 || detail.telnyx_comments.length > 0) && (
                <div className="space-y-2 rounded-md border border-slate-800 bg-slate-900/40 p-3">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                    <p className="text-xs font-medium text-slate-300">Carrier activity log</p>
                  </div>
                  <ul className="max-h-40 space-y-2 overflow-y-auto pr-1">
                    {detail.notifications.map((n) => (
                      <li key={`n-${n.id}`} className="rounded border border-slate-800/80 bg-slate-950/60 px-2 py-1.5">
                        <p className="text-[11px] font-medium text-slate-300">{n.title}</p>
                        <p className="text-[10px] text-slate-500">{displayPortingMessageBody(n.body)}</p>
                        <p className="text-[10px] text-slate-600">{new Date(n.created_at).toLocaleString()}</p>
                      </li>
                    ))}
                    {detail.telnyx_comments.map((c) => (
                      <li key={`c-${c.id}`} className="rounded border border-slate-800/80 bg-slate-950/60 px-2 py-1.5">
                        <p className="text-[10px] text-slate-500">{commentAuthorLabel(c.user_type)}</p>
                        <p className="text-[11px] text-slate-300">{displayPortingMessageBody(c.body)}</p>
                        <p className="text-[10px] text-slate-600">{new Date(c.created_at).toLocaleString()}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-3 border-t border-slate-800 pt-3">
                <p className="text-xs font-medium text-slate-300">Submit corrections to Telnyx</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500">Account number</Label>
                    <Input
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      className="h-8 border-slate-700 bg-slate-950 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500">PIN / passcode</Label>
                    <Input
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      className="h-8 border-slate-700 bg-slate-950 text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-500">Service street address</Label>
                  <Input
                    value={streetAddress}
                    onChange={(e) => setStreetAddress(e.target.value)}
                    className="h-8 border-slate-700 bg-slate-950 text-xs"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500">City</Label>
                    <Input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="h-8 border-slate-700 bg-slate-950 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500">State</Label>
                    <Input
                      value={stateRegion}
                      onChange={(e) => setStateRegion(e.target.value)}
                      className="h-8 border-slate-700 bg-slate-950 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500">ZIP</Label>
                    <Input
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      className="h-8 border-slate-700 bg-slate-950 text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500">Legal entity name</Label>
                    <Input
                      value={entityName}
                      onChange={(e) => setEntityName(e.target.value)}
                      className="h-8 border-slate-700 bg-slate-950 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500">Authorized person</Label>
                    <Input
                      value={authorizedPerson}
                      onChange={(e) => setAuthorizedPerson(e.target.value)}
                      className="h-8 border-slate-700 bg-slate-950 text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500">Revised LOA (PDF)</Label>
                    <Input
                      type="file"
                      accept=".pdf,application/pdf"
                      className="h-8 border-slate-700 bg-slate-950 text-[10px] file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:text-[10px] file:text-slate-200"
                      onChange={(e) => setLoaFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500">Revised invoice (PDF)</Label>
                    <Input
                      type="file"
                      accept=".pdf,application/pdf,image/*"
                      className="h-8 border-slate-700 bg-slate-950 text-[10px] file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:text-[10px] file:text-slate-200"
                      onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-500">Message to carrier (Telnyx comments thread)</Label>
                  <Textarea
                    value={carrierComment}
                    onChange={(e) => setCarrierComment(e.target.value)}
                    placeholder="Explain the correction submitted…"
                    className="min-h-[60px] border-slate-700 bg-slate-950 text-xs"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full bg-orange-600 hover:bg-orange-500"
                  disabled={submitting || !detail.order.telnyx_order_id}
                  onClick={() => void submitCorrections()}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <>
                      <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Submit corrections to Telnyx
                    </>
                  )}
                </Button>
                {!detail.order.telnyx_order_id ? (
                  <p className="flex items-center gap-1 text-[10px] text-slate-500">
                    <FileUp className="h-3 w-3" aria-hidden />
                    Waiting for Telnyx order id — corrections unlock after initial submission.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
