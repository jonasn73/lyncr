"use client"

// Platform admin — invite operators and track provisioning status.

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Ban,
  ChevronRight,
  Loader2,
  MessageSquare,
  Radio,
  Trash2,
  UserPlus,
  UserCheck,
} from "lucide-react"
import type {
  AdminOperatorWorkspaceOption,
  OperatorAdminRow,
  OperatorAssignedWorkspace,
  OperatorOnboardingStatus,
} from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const STATUS_LABEL: Record<OperatorOnboardingStatus, string> = {
  PENDING_INVITE: "Pending invite",
  DEVICE_TESTING: "Device testing",
  ACTIVE_READY: "Active & ready",
}

const STATUS_CLASS: Record<OperatorOnboardingStatus, string> = {
  PENDING_INVITE: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
  DEVICE_TESTING: "bg-sky-500/15 text-sky-200 ring-sky-500/30",
  ACTIVE_READY: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30",
}

function formatStatus(raw: OperatorOnboardingStatus | null): OperatorOnboardingStatus {
  if (raw === "DEVICE_TESTING" || raw === "ACTIVE_READY") return raw
  return "PENDING_INVITE"
}

function formatPhoneDisplay(phone: string | null): string {
  if (!phone) return "—"
  const d = phone.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function canResendInvite(op: OperatorAdminRow): boolean {
  if (!op.is_active) return false
  const status = formatStatus(op.operator_onboarding_status)
  return status === "PENDING_INVITE" || status === "DEVICE_TESTING"
}

function statusBadge(op: OperatorAdminRow) {
  if (!op.is_active) {
    return { label: "Disabled", className: "bg-slate-500/15 text-slate-300 ring-slate-500/30" }
  }
  const status = formatStatus(op.operator_onboarding_status)
  return { label: STATUS_LABEL[status], className: STATUS_CLASS[status] }
}

export function OperatorOnboardingDashboard() {
  const [operators, setOperators] = useState<OperatorAdminRow[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [workspaceOptions, setWorkspaceOptions] = useState<AdminOperatorWorkspaceOption[]>([])
  const [selectedWorkspaceKeys, setSelectedWorkspaceKeys] = useState<Set<string>>(new Set())
  const [workspacesLoading, setWorkspacesLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSentTo, setLastSentTo] = useState<string | null>(null)
  const [manualLink, setManualLink] = useState<string | null>(null)
  const [selectedOperator, setSelectedOperator] = useState<OperatorAdminRow | null>(null)
  const [detailBusy, setDetailBusy] = useState<string | null>(null)
  const [detailNotice, setDetailNotice] = useState<string | null>(null)
  const [detailManualLink, setDetailManualLink] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/receptionists", { credentials: "include", cache: "no-store" })
      const json = (await res.json()) as { data?: { operators?: OperatorAdminRow[] }; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not load operators")
      const rows = json.data?.operators ?? []
      setOperators(rows)
      setSelectedOperator((prev) => {
        if (!prev) return null
        return rows.find((r) => r.id === prev.id) ?? null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let active = true
    fetch("/api/admin/operator-workspaces", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j: { data?: { workspaces?: AdminOperatorWorkspaceOption[] } }) => {
        if (active) setWorkspaceOptions(j.data?.workspaces ?? [])
      })
      .catch(() => active && setWorkspaceOptions([]))
      .finally(() => active && setWorkspacesLoading(false))
    return () => {
      active = false
    }
  }, [])

  const workspaceKey = (w: AdminOperatorWorkspaceOption) =>
    `${w.organization_id}:${w.line_e164 ?? ""}`

  const selectedWorkspaces = useMemo((): OperatorAssignedWorkspace[] => {
    return workspaceOptions
      .filter((w) => selectedWorkspaceKeys.has(workspaceKey(w)))
      .map((w) => ({
        organization_id: w.organization_id,
        business_name: w.business_name,
        line_e164: w.line_e164,
      }))
  }, [workspaceOptions, selectedWorkspaceKeys])

  function toggleWorkspace(key: string) {
    setSelectedWorkspaceKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function openOperatorDetail(op: OperatorAdminRow) {
    setSelectedOperator(op)
    setDetailNotice(null)
    setDetailManualLink(null)
  }

  async function resendInvite(op: OperatorAdminRow) {
    if (!canResendInvite(op)) return
    setDetailBusy("resend")
    setDetailNotice(null)
    setDetailManualLink(null)
    try {
      const res = await fetch("/api/admin/invite-operator/resend", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: op.id }),
      })
      const json = (await res.json()) as {
        data?: {
          phone_display?: string
          onboard_url?: string
          sms_sent?: boolean
          sms_error?: string
        }
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "Resend failed")

      if (json.data?.sms_sent === false) {
        setDetailManualLink(json.data?.onboard_url ?? null)
        setDetailNotice(
          json.data?.sms_error ??
            "Text could not be sent. Copy the setup link below and send it manually."
        )
      } else {
        setDetailNotice(`Setup text sent to ${json.data?.phone_display ?? formatPhoneDisplay(op.phone)}.`)
      }
      await load()
    } catch (e) {
      setDetailNotice(e instanceof Error ? e.message : "Resend failed")
    } finally {
      setDetailBusy(null)
    }
  }

  async function patchOperator(op: OperatorAdminRow, action: "disable" | "enable") {
    setDetailBusy(action)
    setDetailNotice(null)
    try {
      const res = await fetch(`/api/admin/receptionists/${encodeURIComponent(op.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const json = (await res.json()) as { data?: { message?: string }; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Update failed")
      setDetailNotice(json.data?.message ?? (action === "disable" ? "Operator disabled." : "Operator enabled."))
      await load()
    } catch (e) {
      setDetailNotice(e instanceof Error ? e.message : "Update failed")
    } finally {
      setDetailBusy(null)
    }
  }

  async function deleteOperator(op: OperatorAdminRow) {
    const label = op.name || formatPhoneDisplay(op.phone)
    if (
      !window.confirm(
        `Delete ${label}? This removes their operator account and cannot be undone.`
      )
    ) {
      return
    }
    setDetailBusy("delete")
    setDetailNotice(null)
    try {
      const res = await fetch(`/api/admin/receptionists/${encodeURIComponent(op.id)}`, {
        method: "DELETE",
        credentials: "include",
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Delete failed")
      setSelectedOperator(null)
      await load()
    } catch (e) {
      setDetailNotice(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDetailBusy(null)
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLastSentTo(null)
    setManualLink(null)
    setBusy(true)
    try {
      const assigned_workspaces = selectedWorkspaces

      const res = await fetch("/api/admin/invite-operator", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, assigned_workspaces }),
      })
      const json = (await res.json()) as {
        data?: {
          phone_display?: string
          onboard_url?: string
          sms_sent?: boolean
          sms_error?: string
        }
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "Invite failed")

      if (json.data?.sms_sent === false) {
        setManualLink(json.data?.onboard_url ?? null)
        setError(
          json.data?.sms_error ??
            "Text could not be sent. Copy the setup link below and send it manually."
        )
        await load()
        return
      }

      setLastSentTo(json.data?.phone_display ?? phone)
      setName("")
      setPhone("")
      setSelectedWorkspaceKeys(new Set())
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invite failed")
    } finally {
      setBusy(false)
    }
  }

  const detailBadge = selectedOperator ? statusBadge(selectedOperator) : null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Operator onboarding</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Text a setup link to each operator&apos;s cell. They tap the link, test their mic, set a password, and
          enter the live console — no email required.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Card className="border-slate-800 bg-slate-900/60 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-slate-100">
              <UserPlus className="h-4 w-4 text-violet-300" aria-hidden />
              Invite operator
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="op-name" className="text-slate-300">
                  Full name
                </Label>
                <Input
                  id="op-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jordan Lee"
                  required
                  className="border-slate-700 bg-slate-950/80"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="op-phone" className="text-slate-300">
                  Cell phone
                </Label>
                <Input
                  id="op-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(502) 555-0100"
                  required
                  autoComplete="tel"
                  className="border-slate-700 bg-slate-950/80"
                />
                <p className="text-[11px] text-slate-500">We text a one-tap setup link to this number.</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Workspace clearance
                </p>
                {workspacesLoading ? (
                  <p className="flex items-center gap-2 py-2 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Loading businesses…
                  </p>
                ) : workspaceOptions.length === 0 ? (
                  <p className="text-xs text-slate-500">No workspaces found yet.</p>
                ) : (
                  <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
                    {workspaceOptions.map((w) => {
                      const key = workspaceKey(w)
                      const checked = selectedWorkspaceKeys.has(key)
                      const lineLabel = w.line_e164
                        ? w.line_label?.trim() || w.line_e164
                        : "All lines"
                      return (
                        <li key={key}>
                          <label
                            className={cn(
                              "flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                              checked
                                ? "border-emerald-500/40 bg-emerald-500/10"
                                : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleWorkspace(key)}
                              className="mt-0.5 accent-emerald-500"
                            />
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-slate-200">{w.business_name}</span>
                              <span className="block truncate text-[10px] text-slate-500">
                                {lineLabel} · {w.owner_email}
                              </span>
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {selectedWorkspaces.length > 0 ? (
                  <p className="text-[10px] text-emerald-300/90">
                    {selectedWorkspaces.length} workspace{selectedWorkspaces.length === 1 ? "" : "s"} selected
                  </p>
                ) : null}
              </div>
              {error ? <p className="text-sm text-red-300">{error}</p> : null}
              {manualLink ? (
                <p className="break-all rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                  Setup link (text manually): {manualLink}
                </p>
              ) : null}
              {lastSentTo ? (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                  Text sent to {lastSentTo}. They can tap the link to finish setup.
                </p>
              ) : null}
              <Button type="submit" disabled={busy} className="w-full bg-violet-600 hover:bg-violet-500">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <MessageSquare className="h-4 w-4" aria-hidden />
                )}
                Text invite
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base text-slate-100">
              <Radio className="h-4 w-4 text-emerald-300" aria-hidden />
              Provisioning queue
            </CardTitle>
            <Button type="button" variant="ghost" size="sm" onClick={() => void load()} className="text-slate-400">
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading operators…
              </div>
            ) : operators.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No operators yet. Send your first invite.</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {operators.map((op) => {
                  const badge = statusBadge(op)
                  return (
                    <li key={op.id}>
                      <button
                        type="button"
                        onClick={() => openOperatorDetail(op)}
                        className="flex w-full flex-wrap items-start justify-between gap-3 py-4 text-left transition-colors first:pt-0 hover:bg-slate-900/40"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-100">{op.name || op.phone || op.email}</p>
                          <p className="text-xs text-slate-500">{formatPhoneDisplay(op.phone)}</p>
                          {op.assigned_workspaces.length > 0 ? (
                            <p className="mt-1 text-xs text-slate-400">
                              {op.assigned_workspaces.map((w) => w.business_name).join(" · ")}
                            </p>
                          ) : null}
                          <p className="mt-1 text-[10px] text-slate-600">Tap for details</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ring-1",
                              badge.className
                            )}
                          >
                            {badge.label}
                          </span>
                          <ChevronRight className="h-4 w-4 text-slate-600" aria-hidden />
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(selectedOperator)} onOpenChange={(open) => !open && setSelectedOperator(null)}>
        <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-md">
          {selectedOperator ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-slate-100">
                  {selectedOperator.name || formatPhoneDisplay(selectedOperator.phone)}
                </DialogTitle>
                <DialogDescription className="text-slate-400">
                  Operator details and provisioning actions
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">Status</span>
                  {detailBadge ? (
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ring-1",
                        detailBadge.className
                      )}
                    >
                      {detailBadge.label}
                    </span>
                  ) : null}
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Cell</span>
                  <span className="text-slate-200">{formatPhoneDisplay(selectedOperator.phone)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Invited</span>
                  <span className="text-slate-200">{formatWhen(selectedOperator.created_at)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Link expires</span>
                  <span className="text-slate-200">{formatWhen(selectedOperator.invitation_expires_at)}</span>
                </div>
                {selectedOperator.assigned_workspaces.length > 0 ? (
                  <div>
                    <span className="text-slate-500">Workspaces</span>
                    <p className="mt-1 text-slate-200">
                      {selectedOperator.assigned_workspaces.map((w) => w.business_name).join(", ")}
                    </p>
                  </div>
                ) : null}
              </div>

              {detailNotice ? (
                <p
                  className={cn(
                    "rounded-lg border p-3 text-xs",
                    detailManualLink
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                  )}
                >
                  {detailNotice}
                  {detailManualLink ? (
                    <span className="mt-2 block break-all">Setup link: {detailManualLink}</span>
                  ) : null}
                </p>
              ) : null}

              <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
                {canResendInvite(selectedOperator) ? (
                  <Button
                    type="button"
                    className="w-full bg-violet-600 hover:bg-violet-500"
                    disabled={Boolean(detailBusy)}
                    onClick={() => void resendInvite(selectedOperator)}
                  >
                    {detailBusy === "resend" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <MessageSquare className="h-4 w-4" aria-hidden />
                    )}
                    Resend setup text
                  </Button>
                ) : formatStatus(selectedOperator.operator_onboarding_status) === "ACTIVE_READY" ? (
                  <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200/90">
                    This operator finished setup and is active. Disable them to pause routing.
                  </p>
                ) : !selectedOperator.is_active ? (
                  <p className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
                    Re-enable this operator, then use Resend setup text if they still need to finish onboarding.
                  </p>
                ) : null}

                {selectedOperator.is_active ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                    disabled={Boolean(detailBusy)}
                    onClick={() => void patchOperator(selectedOperator, "disable")}
                  >
                    {detailBusy === "disable" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Ban className="h-4 w-4" aria-hidden />
                    )}
                    Disable operator
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                    disabled={Boolean(detailBusy)}
                    onClick={() => void patchOperator(selectedOperator, "enable")}
                  >
                    {detailBusy === "enable" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <UserCheck className="h-4 w-4" aria-hidden />
                    )}
                    Re-enable operator
                  </Button>
                )}

                <Button
                  type="button"
                  variant="destructive"
                  className="w-full"
                  disabled={Boolean(detailBusy)}
                  onClick={() => void deleteOperator(selectedOperator)}
                >
                  {detailBusy === "delete" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden />
                  )}
                  Delete operator
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
