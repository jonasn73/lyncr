"use client"

// Advanced operator drawer — status, notes, manual DID, hard reset.

import { useCallback, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Loader2, Phone, Wallet, Zap, Building2, Users, Mail, MessageSquare, HardHat } from "lucide-react"
import { adjustUserCredit } from "@/app/actions/admin-actions"
import { startImpersonation } from "@/app/actions/admin-impersonation"
import type {
  AdminBusinessEconomics,
  AdminTenantControls,
  LyncrAdminDirectoryRow,
  SmsRegistrationOrgStatus,
} from "@/lib/types"
import { ACCOUNT_STATUSES, accountStatusLabel } from "@/lib/account-status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { BusinessMoneyBreakdown } from "@/components/admin/business-money"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { PortingControlDesk } from "@/components/admin/porting-control-desk"
import {
  AdminProvisionTechnicianModal,
  resolveAdminProvisionWorkspaceId,
} from "@/components/admin/admin-provision-technician-modal"

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
  if (status === "PENDING_APPROVAL") return "border-warning/60 bg-warning/40 text-warning"
  if (status === "APPROVED") return "border-success/60 bg-success/40 text-success"
  if (status === "REJECTED") return "border-destructive/60 bg-destructive/40 text-destructive"
  return "border-border bg-card/60 text-muted-foreground"
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
  businessEconomics = null,
}: {
  row: LyncrAdminDirectoryRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  fetchLatestAdminStats: (silent?: boolean) => Promise<void>
  /** Precomputed P&L from Ops Home /admin/data — shown at top of the drawer. */
  businessEconomics?: AdminBusinessEconomics | null
}) {
  const [targetStatus, setTargetStatus] = useState("active")
  const [adminNotes, setAdminNotes] = useState("")
  const [manualPhone, setManualPhone] = useState("")
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Wallet adjustment.
  const [walletAmount, setWalletAmount] = useState("")
  const [walletBusy, setWalletBusy] = useState(false)
  // Seed from the row prop already available on first render — a hardcoded 0 here flashed
  // "$0.00" for one frame before the useEffect below applied the real value on every open.
  const [creditBalance, setCreditBalance] = useState(() => row?.carrier_credit ?? 0)

  // Feature flags + provisioned lines (loaded from /api/admin/users/[id]/controls).
  const [controls, setControls] = useState<AdminTenantControls | null>(null)
  const [controlsLoading, setControlsLoading] = useState(false)
  const [flagBusy, setFlagBusy] = useState<string | null>(null)
  const [releaseBusy, setReleaseBusy] = useState<string | null>(null)
  const [provisionTechOpen, setProvisionTechOpen] = useState(false)
  const [lineOverrideDrafts, setLineOverrideDrafts] = useState<Record<string, string>>({})
  const [impersonatePending, startImpersonateTransition] = useTransition()
  const [statusBusy, setStatusBusy] = useState(false)

  const loadControls = useCallback(async (userId: string) => {
    setControlsLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/controls`, { credentials: "include", cache: "no-store" })
      const json = (await res.json().catch(() => ({}))) as { data?: AdminTenantControls; error?: string }
      if (res.ok && json.data) setControls(json.data)
      else setControls(emptyAdminControls())
      const drafts: Record<string, string> = {}
      for (const line of json.data?.phone_lines ?? []) {
        drafts[line.id] = line.admin_routing_override_phone ?? ""
      }
      setLineOverrideDrafts(drafts)
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

  async function setAccountStatusQuick(nextStatus: string) {
    if (!row) return
    setStatusBusy(true)
    try {
      const res = await fetch("/api/admin/user-override", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.user_id, targetStatus: nextStatus }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Status update failed")
      setTargetStatus(nextStatus)
      toast.success(nextStatus === "active" ? "Shop approved" : "Shop denied")
      await fetchLatestAdminStats(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status update failed")
    } finally {
      setStatusBusy(false)
    }
  }

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
          phoneLineRoutingOverrides: (controls?.phone_lines ?? []).map((line) => ({
            phoneLineId: line.id,
            adminRoutingOverridePhone: lineOverrideDrafts[line.id]?.trim() || null,
          })),
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
      <SheetContent side="right" className="w-full border-border bg-[#0b1120] text-foreground sm:max-w-lg">
        <SheetHeader>
          {/* Shop name is the title so you know whose account you opened. */}
          <SheetTitle className="text-foreground">
            {row?.business_name.trim() || row?.email || "Manage shop"}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground">
            {row ? row.email : "Select a shop"}
          </SheetDescription>
        </SheetHeader>

        {row ? (
          <form
            id="admin-user-override-form"
            className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-2"
            onSubmit={(e) => void handleSaveSubmit(e)}
          >
            {targetStatus === "pending" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="bg-success hover:bg-success"
                  disabled={statusBusy}
                  onClick={() => void setAccountStatusQuick("active")}
                >
                  Approve shop
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={statusBusy}
                  onClick={() => void setAccountStatusQuick("denied")}
                >
                  Deny shop
                </Button>
              </div>
            ) : null}

            <Button
              type="button"
              variant="outline"
              className="w-full border-border text-foreground"
              disabled={impersonatePending}
              onClick={() => {
                startImpersonateTransition(async () => {
                  const result = await startImpersonation(row.user_id)
                  if (result?.ok === false) toast.error(result.error)
                })
              }}
            >
              {impersonatePending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Opening as them…
                </>
              ) : (
                "Open as them"
              )}
            </Button>

            {businessEconomics ? (
              <div className="rounded-xl border border-border bg-background/50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Business money
                </p>
                <BusinessMoneyBreakdown row={businessEconomics} />
              </div>
            ) : null}

            {/* Routing: assign the shop’s main Telnyx number. */}
            <div className="space-y-2">
              <Label className="text-foreground">Direct phone assignment (Telnyx DID)</Label>
              <Input
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                placeholder="+15551234567"
                className="border-border bg-background font-mono text-foreground"
              />
              <p className="text-xs text-muted-foreground">Bypasses self-service purchase — assigns or updates the primary active line.</p>
            </div>

            {/* Per-line override — this is what shows the purple bar on a shop dashboard. */}
            <div className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-success" aria-hidden />
                <Label className="text-foreground">Active phone lines</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Each shop on this login has a line. Clear “Admin override” and Save to turn off direct routing.
              </p>
              {controlsLoading && !controls ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading lines…
                </div>
              ) : controls && controls.phone_lines.length > 0 ? (
                <ul className="space-y-2">
                  {controls.phone_lines.map((line) => {
                    const shopName =
                      controls.organizations.find((o) => o.id === line.organization_id)?.name ?? line.label
                    return (
                    <li
                      key={line.id}
                      className="flex flex-col gap-2 rounded-md border border-border bg-card/50 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{shopName}</p>
                          <p className="truncate font-mono text-xs text-foreground">{line.number}</p>
                          <p className="truncate text-2xs text-muted-foreground">
                            {line.label} · <span className="capitalize">{line.status}</span>
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0 border-destructive/60 bg-destructive/30 text-destructive hover:bg-destructive/40"
                          disabled={releaseBusy === line.id || line.status !== "active"}
                          onClick={() => void releaseLine(line.id)}
                        >
                          {releaseBusy === line.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            "Release"
                          )}
                        </Button>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-2xs text-muted-foreground">Admin override for this line</Label>
                        <Input
                          value={lineOverrideDrafts[line.id] ?? ""}
                          onChange={(e) =>
                            setLineOverrideDrafts((prev) => ({ ...prev, [line.id]: e.target.value }))
                          }
                          placeholder="Empty = normal routing"
                          className="border-border bg-background font-mono text-xs text-foreground"
                        />
                      </div>
                    </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No provisioned lines on this account.</p>
              )}
            </div>

            {/* Wallet: add or subtract prepaid phone credit. */}
            <div className="space-y-2 rounded-lg border border-border bg-background/40 p-4">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-violet-300" aria-hidden />
                <Label className="text-foreground">Adjust wallet balance</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Current carrier credit:{" "}
                <span className="font-semibold tabular-nums text-foreground">{formatUsd(creditBalance)}</span>
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={walletAmount}
                  onChange={(e) => setWalletAmount(e.target.value)}
                  placeholder="± USD (e.g. 25 or -10)"
                  className="border-border bg-background text-foreground"
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

            <Accordion type="single" collapsible className="rounded-lg border border-border">
              <AccordionItem value="advanced" className="border-0 px-3">
                <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
                  Advanced
                </AccordionTrigger>
                <AccordionContent className="space-y-6 pb-4">
            <div className="space-y-2">
              <Label className="text-foreground">Account status</Label>
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
                        "border-border",
                        selected && s === "active" && "border-success bg-success/20 text-success",
                        selected && s === "pending" && "border-warning bg-warning/20 text-warning",
                        selected && s === "denied" && "border-border bg-zinc-600/20 text-foreground",
                        selected && s === "suspended" && "border-destructive bg-destructive/20 text-destructive",
                        selected && s === "flagged" && "border-warning bg-warning/20 text-warning",
                        !selected && "bg-background text-foreground hover:bg-card"
                      )}
                      onClick={() => setTargetStatus(s)}
                    >
                      {accountStatusLabel(s)}
                    </Button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Suspended accounts cannot receive or route calls until reactivated.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-foreground">Custom admin routing notes</Label>
              <Textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="e.g. VIP client — manual billing clear"
                className="min-h-[100px] border-border bg-background text-foreground"
              />
            </div>

            {/* Feature controls */}
            <div className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-warning" aria-hidden />
                <Label className="text-foreground">Feature controls</Label>
              </div>
              {controlsLoading && !controls ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…
                </div>
              ) : (
                FEATURE_CONTROLS.map((f) => (
                  <div key={f.id} className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{f.label}</p>
                      <p className="text-xs text-muted-foreground">{f.description}</p>
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

            {/* Business actions — platform-admin manual field tech provisioning */}
            <div className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
              <div className="flex items-center gap-2">
                <HardHat className="h-4 w-4 text-violet-300" aria-hidden />
                <Label className="text-foreground">Business actions</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Provision an active field technician directly on this owner&apos;s roster — binds to their workspace
                records without sending an SMS invite.
              </p>
              <Button
                type="button"
                className="w-full bg-violet-600 hover:bg-violet-500"
                disabled={!row || controlsLoading}
                onClick={() => setProvisionTechOpen(true)}
              >
                + Add Tech to this Business
              </Button>
            </div>

            {/* Workspace & team infrastructure */}
            <div className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-sky-300" aria-hidden />
                  <Label className="text-foreground">Workspace &amp; team infrastructure</Label>
                </div>
                {controls?.is_multi_workspace ? (
                  <Badge className="border-violet-700/60 bg-violet-950/40 text-violet-200">
                    Multi-workspace tenant
                  </Badge>
                ) : null}
              </div>

              {controlsLoading && !controls ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <p>
                      <span className="font-medium text-foreground">
                        {controls?.team_roster.active_receptionists ?? 0}
                      </span>{" "}
                      active receptionist
                      {(controls?.team_roster.active_receptionists ?? 0) === 1 ? "" : "s"}
                      {" · "}
                      <span className="font-medium text-foreground">
                        {controls?.team_roster.active_field_technicians ?? 0}
                      </span>{" "}
                      active dispatch tech
                      {(controls?.team_roster.active_field_technicians ?? 0) === 1 ? "" : "s"}
                    </p>
                  </div>

                  {!controls || controls.organizations.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No workspaces found for this owner.</p>
                  ) : (
                    <ul className="space-y-2">
                      {controls.organizations.map((org) => (
                        <li
                          key={org.id}
                          className="rounded-md border border-border bg-card/50 px-3 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {org.name}
                                {org.is_default ? (
                                  <span className="ml-1.5 text-micro font-normal uppercase tracking-wide text-muted-foreground">
                                    default
                                  </span>
                                ) : null}
                              </p>
                              {org.sms_registration?.legal_business_name || org.messaging_10dlc?.legal_company_name ? (
                                <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                                  {org.sms_registration?.legal_business_name ||
                                    org.messaging_10dlc?.legal_company_name}
                                </p>
                              ) : null}
                              {org.messaging_10dlc?.brand_id || org.messaging_10dlc?.campaign_id ? (
                                <p className="mt-1 truncate font-mono text-micro text-muted-foreground">
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
                            <p className="mt-1.5 text-micro capitalize text-muted-foreground">
                              Telnyx registration: {org.messaging_10dlc.status.replace(/_/g, " ")}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}

                  {(controls?.pending_invites.length ?? 0) > 0 ? (
                    <Accordion type="single" collapsible className="rounded-md border border-border">
                      <AccordionItem value="pending-invites" className="border-0 px-3">
                        <AccordionTrigger className="py-3 text-xs font-medium text-foreground hover:no-underline">
                          Pending team invites ({controls?.pending_invites.length})
                        </AccordionTrigger>
                        <AccordionContent>
                          <ul className="space-y-2 pb-1">
                            {controls?.pending_invites.map((inv) => (
                              <li
                                key={inv.id}
                                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-3 py-2"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  {inv.channel === "SMS" ? (
                                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                                  ) : (
                                    <Mail className="h-3.5 w-3.5 shrink-0 text-sky-400" aria-hidden />
                                  )}
                                  <div className="min-w-0">
                                    <p className="truncate font-mono text-xs text-foreground">{inv.target}</p>
                                    <p className="text-micro text-muted-foreground">
                                      {inv.channel} · expires{" "}
                                      {new Date(inv.expires_at).toLocaleDateString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                      })}
                                    </p>
                                  </div>
                                </div>
                                <Badge className="border-warning/60 bg-warning/40 text-warning">
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

            {row ? <PortingControlDesk ownerUserId={row.user_id} /> : null}

            <div className="rounded-lg border border-destructive/50 bg-destructive/20 p-4">
              <p className="text-sm font-medium text-destructive">Danger zone</p>
              <p className="mt-1 text-xs text-destructive/70">
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
                <AlertDialogContent className="border-border bg-card text-foreground">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset active lines?</AlertDialogTitle>
                    <AlertDialogDescription className="text-muted-foreground">
                      This permanently removes {row.email}&apos;s assigned numbers and zeroes their carrier credit.
                      This cannot be undone from the admin console.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-border bg-background">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive hover:bg-destructive"
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
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </form>
        ) : null}

        {row ? (
          <AdminProvisionTechnicianModal
            open={provisionTechOpen}
            onOpenChange={setProvisionTechOpen}
            ownerUserId={row.user_id}
            workspaceId={resolveAdminProvisionWorkspaceId(row.user_id, controls?.organizations)}
            ownerEmail={row.email}
            onSuccess={() => {
              toast.success("Field technician provisioned on this business roster")
              void loadControls(row.user_id)
              void fetchLatestAdminStats(true)
            }}
          />
        ) : null}

        <SheetFooter className="border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            className="border-border text-foreground"
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
