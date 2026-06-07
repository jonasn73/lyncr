"use client"

// Advanced operator drawer — status, notes, manual DID, hard reset.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Phone, Wallet, Zap, Building2, Users, Mail, MessageSquare } from "lucide-react"
import { adjustUserCredit } from "@/app/actions/admin-actions"
import type { AdminTenantControls, LyncrAdminDirectoryRow, SmsRegistrationOrgStatus } from "@/lib/types"
import { ACCOUNT_STATUSES, accountStatusLabel } from "@/lib/account-status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

const FEATURE_CONTROLS: { id: string; label: string; description: string }[] = [
  { id: "field_tech_hud", label: "Field Tech HUD", description: "Mobile technician console, dispatch + live tracking." },
  { id: "sms_automation", label: "SMS Automation", description: "Automated booking / en-route / review customer texts." },
]

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

/** Human label for org-level SMS registration status badges. */
function smsRegistrationStatusLabel(status: SmsRegistrationOrgStatus): string {
  if (status === "PENDING_APPROVAL") return "Pending"
  if (status === "APPROVED") return "Approved"
  if (status === "REJECTED") return "Rejected"
  return "None"
}

/** Tailwind classes for org-level 10DLC / SMS registration badges. */
function smsRegistrationBadgeClass(status: SmsRegistrationOrgStatus): string {
  if (status === "PENDING_APPROVAL") return "border-amber-700/60 bg-amber-950/40 text-amber-200"
  if (status === "APPROVED") return "border-emerald-700/60 bg-emerald-950/40 text-emerald-200"
  if (status === "REJECTED") return "border-red-800/60 bg-red-950/40 text-red-200"
  return "border-slate-700 bg-slate-900/60 text-slate-400"
}

/** Default empty control hub payload when the API fails. */
function emptyAdminControls(): AdminTenantControls {
  return {
    feature_flags: {},
    phone_lines: [],
    is_multi_workspace: false,
    team_roster: { active_receptionists: 0, active_field_technicians: 0 },
    organizations: [],
    pending_invites: [],
  }
}
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export function AdminUserManageDrawer({
  row,
  open,
  onOpenChange,
  fetchLatestAdminStats,
}: {
  row: LyncrAdminDirectoryRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  fetchLatestAdminStats: (silent?: boolean) => Promise<void>
}) {
  const [targetStatus, setTargetStatus] = useState("active")
  const [adminNotes, setAdminNotes] = useState("")
  const [manualPhone, setManualPhone] = useState("")
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Wallet adjustment.
  const [walletAmount, setWalletAmount] = useState("")
  const [walletBusy, setWalletBusy] = useState(false)
  const [creditBalance, setCreditBalance] = useState(0)

  // Feature flags + provisioned lines (loaded from /api/admin/users/[id]/controls).
  const [controls, setControls] = useState<AdminTenantControls | null>(null)
  const [controlsLoading, setControlsLoading] = useState(false)
  const [flagBusy, setFlagBusy] = useState<string | null>(null)
  const [releaseBusy, setReleaseBusy] = useState<string | null>(null)

  const loadControls = useCallback(async (userId: string) => {
    setControlsLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/controls`, { credentials: "include", cache: "no-store" })
      const json = (await res.json().catch(() => ({}))) as { data?: AdminTenantControls; error?: string }
      if (res.ok && json.data) setControls(json.data)
      else setControls(emptyAdminControls())
    } catch {
      setControls(emptyAdminControls())
    } finally {
      setControlsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!row) return
    setTargetStatus(row.account_status || "active")
    setAdminNotes(row.custom_routing_note ?? "")
    setManualPhone(row.phone_number ?? "")
    setWalletAmount("")
    setCreditBalance(row.carrier_credit)
    setControls(null)
    if (open) void loadControls(row.user_id)
  }, [row, open, loadControls])

  async function applyWalletAdjustment() {
    if (!row) return
    const amount = Number(walletAmount)
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error("Enter a non-zero amount (e.g. 25 or -10)")
      return
    }
    setWalletBusy(true)
    try {
      const result = await adjustUserCredit(row.user_id, amount)
      if (!result.ok) throw new Error(result.error)
      setCreditBalance(result.carrier_credit_after)
      setWalletAmount("")
      toast.success(`Wallet updated — new balance ${formatUsd(result.carrier_credit_after)}`)
      await fetchLatestAdminStats(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Wallet adjustment failed")
    } finally {
      setWalletBusy(false)
    }
  }

  async function toggleFeature(flag: string, enabled: boolean) {
    if (!row) return
    setFlagBusy(flag)
    // Optimistic.
    setControls((prev) => (prev ? { ...prev, feature_flags: { ...prev.feature_flags, [flag]: enabled } } : prev))
    try {
      const res = await fetch(`/api/admin/users/${row.user_id}/controls`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag, enabled }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: { feature_flags: Record<string, boolean> }; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Update failed")
      if (json.data) setControls((prev) => (prev ? { ...prev, feature_flags: json.data!.feature_flags } : prev))
      toast.success(`${enabled ? "Enabled" : "Disabled"} ${flag.replace(/_/g, " ")}`)
    } catch (e) {
      // Revert on failure.
      setControls((prev) => (prev ? { ...prev, feature_flags: { ...prev.feature_flags, [flag]: !enabled } } : prev))
      toast.error(e instanceof Error ? e.message : "Could not update feature")
    } finally {
      setFlagBusy(null)
    }
  }

  async function releaseLine(lineId: string) {
    if (!row) return
    setReleaseBusy(lineId)
    try {
      const res = await fetch(`/api/admin/users/${row.user_id}/controls`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: AdminTenantControls; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Release failed")
      if (json.data) setControls(json.data)
      toast.success("Number released back to the pool")
      await fetchLatestAdminStats(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not release line")
    } finally {
      setReleaseBusy(null)
    }
  }

  async function handleSaveSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    await saveOverrides()
  }

  async function saveOverrides() {
    if (!row) return
    setSaving(true)
    try {
      const res = await fetch("/api/admin/user-override", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: row.user_id,
          targetStatus,
          adminNotes,
          manualPhoneOverride: manualPhone.trim() || null,
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Save failed")
      toast.success("User overrides saved")
      await fetchLatestAdminStats(true)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  async function resetActiveLines() {
    if (!row) return
    setResetting(true)
    try {
      const res = await fetch("/api/admin/user-override", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.user_id, resetActiveLines: true }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Reset failed")
      toast.success("Active lines cleared and balance reset to $0.00")
      await fetchLatestAdminStats(true)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed")
    } finally {
      setResetting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-slate-800 bg-[#0b1120] text-slate-100 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-slate-50">Advanced user management</SheetTitle>
          <SheetDescription className="text-slate-400">
            {row ? `${row.email} · ${row.user_id}` : "Select a user"}
          </SheetDescription>
        </SheetHeader>

        {row ? (
          <form
            id="admin-user-override-form"
            className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-2"
            onSubmit={(e) => void handleSaveSubmit(e)}
          >
            <div className="space-y-2">
              <Label className="text-slate-300">Account status</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Account status">
                {ACCOUNT_STATUSES.map((s) => {
                  const selected = targetStatus === s
                  return (
                    <Button
                      key={s}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={selected}
                      className={cn(
                        "border-slate-700",
                        selected && s === "active" && "border-emerald-600 bg-emerald-600/20 text-emerald-200",
                        selected && s === "suspended" && "border-red-600 bg-red-600/20 text-red-200",
                        selected && s === "flagged" && "border-amber-600 bg-amber-600/20 text-amber-200",
                        !selected && "bg-slate-950 text-slate-300 hover:bg-slate-900"
                      )}
                      onClick={() => setTargetStatus(s)}
                    >
                      {accountStatusLabel(s)}
                    </Button>
                  )
                })}
              </div>
              <p className="text-xs text-slate-500">
                Suspended accounts cannot receive or route calls until reactivated.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Custom admin routing notes</Label>
              <Textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="e.g. VIP client — manual billing clear"
                className="min-h-[100px] border-slate-700 bg-slate-950 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Direct phone assignment (Telnyx DID)</Label>
              <Input
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                placeholder="+15551234567"
                className="border-slate-700 bg-slate-950 font-mono text-slate-100"
              />
              <p className="text-xs text-slate-500">Bypasses self-service purchase — assigns or updates the primary active line.</p>
            </div>

            {/* Wallet balance override */}
            <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-violet-300" aria-hidden />
                <Label className="text-slate-200">Adjust wallet balance</Label>
              </div>
              <p className="text-xs text-slate-500">
                Current carrier credit:{" "}
                <span className="font-semibold tabular-nums text-slate-200">{formatUsd(creditBalance)}</span>
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={walletAmount}
                  onChange={(e) => setWalletAmount(e.target.value)}
                  placeholder="± USD (e.g. 25 or -10)"
                  className="border-slate-700 bg-slate-950 text-slate-100"
                  disabled={walletBusy}
                />
                <Button
                  type="button"
                  className="shrink-0 bg-violet-600 hover:bg-violet-500"
                  disabled={walletBusy}
                  onClick={() => void applyWalletAdjustment()}
                >
                  {walletBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Apply"}
                </Button>
              </div>
            </div>

            {/* Feature controls */}
            <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-300" aria-hidden />
                <Label className="text-slate-200">Feature controls</Label>
              </div>
              {controlsLoading && !controls ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…
                </div>
              ) : (
                FEATURE_CONTROLS.map((f) => (
                  <div key={f.id} className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200">{f.label}</p>
                      <p className="text-xs text-slate-500">{f.description}</p>
                    </div>
                    <Switch
                      checked={controls?.feature_flags?.[f.id] === true}
                      disabled={flagBusy === f.id || controlsLoading}
                      onCheckedChange={(v) => void toggleFeature(f.id, v)}
                      aria-label={f.label}
                    />
                  </div>
                ))
              )}
            </div>

            {/* Active provisioned lines */}
            <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-emerald-300" aria-hidden />
                <Label className="text-slate-200">Active phone lines</Label>
              </div>
              {controlsLoading && !controls ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…
                </div>
              ) : !controls || controls.phone_lines.length === 0 ? (
                <p className="text-xs text-slate-500">No provisioned lines on this account.</p>
              ) : (
                <ul className="space-y-2">
                  {controls.phone_lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm text-slate-200">{line.number}</p>
                        <p className="truncate text-[11px] text-slate-500">
                          {line.label} · <span className="capitalize">{line.status}</span> · {line.type}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 border-red-900/60 bg-red-950/30 text-red-200 hover:bg-red-900/40"
                        disabled={releaseBusy === line.id || line.status !== "active"}
                        onClick={() => void releaseLine(line.id)}
                      >
                        {releaseBusy === line.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          "Release"
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Workspace & team infrastructure */}
            <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-sky-300" aria-hidden />
                  <Label className="text-slate-200">Workspace &amp; team infrastructure</Label>
                </div>
                {controls?.is_multi_workspace ? (
                  <Badge className="border-violet-700/60 bg-violet-950/40 text-violet-200">
                    Multi-workspace tenant
                  </Badge>
                ) : null}
              </div>

              {controlsLoading && !controls ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2 text-xs text-slate-400">
                    <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                    <p>
                      <span className="font-medium text-slate-300">
                        {controls?.team_roster.active_receptionists ?? 0}
                      </span>{" "}
                      active receptionist
                      {(controls?.team_roster.active_receptionists ?? 0) === 1 ? "" : "s"}
                      {" · "}
                      <span className="font-medium text-slate-300">
                        {controls?.team_roster.active_field_technicians ?? 0}
                      </span>{" "}
                      active dispatch tech
                      {(controls?.team_roster.active_field_technicians ?? 0) === 1 ? "" : "s"}
                    </p>
                  </div>

                  {!controls || controls.organizations.length === 0 ? (
                    <p className="text-xs text-slate-500">No workspaces found for this owner.</p>
                  ) : (
                    <ul className="space-y-2">
                      {controls.organizations.map((org) => (
                        <li
                          key={org.id}
                          className="rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2.5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-200">
                                {org.name}
                                {org.is_default ? (
                                  <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-slate-500">
                                    default
                                  </span>
                                ) : null}
                              </p>
                              {org.sms_registration?.legal_business_name || org.messaging_10dlc?.legal_company_name ? (
                                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                                  {org.sms_registration?.legal_business_name ||
                                    org.messaging_10dlc?.legal_company_name}
                                </p>
                              ) : null}
                              {org.messaging_10dlc?.brand_id || org.messaging_10dlc?.campaign_id ? (
                                <p className="mt-1 truncate font-mono text-[10px] text-slate-600">
                                  {org.messaging_10dlc.brand_id ? `Brand ${org.messaging_10dlc.brand_id}` : null}
                                  {org.messaging_10dlc.brand_id && org.messaging_10dlc.campaign_id ? " · " : null}
                                  {org.messaging_10dlc.campaign_id
                                    ? `Campaign ${org.messaging_10dlc.campaign_id}`
                                    : null}
                                </p>
                              ) : null}
                            </div>
                            <Badge className={cn("shrink-0", smsRegistrationBadgeClass(org.sms_registration_status))}>
                              10DLC · {smsRegistrationStatusLabel(org.sms_registration_status)}
                            </Badge>
                          </div>
                          {org.messaging_10dlc?.status ? (
                            <p className="mt-1.5 text-[10px] capitalize text-slate-600">
                              Telnyx registration: {org.messaging_10dlc.status.replace(/_/g, " ")}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}

                  {(controls?.pending_invites.length ?? 0) > 0 ? (
                    <Accordion type="single" collapsible className="rounded-md border border-slate-800">
                      <AccordionItem value="pending-invites" className="border-0 px-3">
                        <AccordionTrigger className="py-3 text-xs font-medium text-slate-300 hover:no-underline">
                          Pending team invites ({controls?.pending_invites.length})
                        </AccordionTrigger>
                        <AccordionContent>
                          <ul className="space-y-2 pb-1">
                            {controls?.pending_invites.map((inv) => (
                              <li
                                key={inv.id}
                                className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-2"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  {inv.channel === "SMS" ? (
                                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                                  ) : (
                                    <Mail className="h-3.5 w-3.5 shrink-0 text-sky-400" aria-hidden />
                                  )}
                                  <div className="min-w-0">
                                    <p className="truncate font-mono text-xs text-slate-200">{inv.target}</p>
                                    <p className="text-[10px] text-slate-500">
                                      {inv.channel} · expires{" "}
                                      {new Date(inv.expires_at).toLocaleDateString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                      })}
                                    </p>
                                  </div>
                                </div>
                                <Badge className="border-amber-700/60 bg-amber-950/40 text-amber-200">
                                  {inv.status}
                                </Badge>
                              </li>
                            ))}
                          </ul>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ) : null}
                </>
              )}
            </div>

            <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4">
              <p className="text-sm font-medium text-red-200">Danger zone</p>
              <p className="mt-1 text-xs text-red-200/70">
                Removes all active phone numbers and sets carrier credit to $0.00.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="mt-3"
                    disabled={resetting}
                  >
                    {resetting ? "Resetting..." : "Reset active lines"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-slate-800 bg-slate-900 text-slate-100">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset active lines?</AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-400">
                      This permanently removes {row.email}&apos;s assigned numbers and zeroes their carrier credit.
                      This cannot be undone from the admin console.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-slate-700 bg-slate-950">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700"
                      onClick={(e) => {
                        e.preventDefault()
                        void resetActiveLines()
                      }}
                    >
                      Yes, reset account lines
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </form>
        ) : null}

        <SheetFooter className="border-t border-slate-800 pt-4">
          <Button
            type="button"
            variant="outline"
            className="border-slate-700 text-slate-200"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="admin-user-override-form"
            className="bg-violet-600 hover:bg-violet-500"
            disabled={!row || saving}
          >
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
