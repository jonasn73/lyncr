"use client"

// One settings surface per field tech — mirrors ReceptionistSettingsSheet so both roles feel
// like the same product. Pay / Access / Account still open their existing editors on top of
// this sheet (their forms are non-trivial enough to keep as-is) — everything about one person
// starts from tapping their row in the unified Team list.

import { Loader2, Pencil, Send, ShieldCheck, Trash2 } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { grantedFieldTechLabels } from "@/lib/field-technician-capabilities"
import type { FieldTechnician } from "@/lib/types"
import type { RosterPlan } from "@/components/compensation/pay-plan-editor"

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function TechnicianSettingsSheet({
  member,
  avatarColor,
  togglingActive,
  plan,
  showWorkspacePicker,
  organizations,
  movingWorkspace,
  onToggleActive,
  onMoveWorkspace,
  onEditPay,
  onEditAccess,
  onEditAccount,
  onResendInvite,
  resendBusy,
  resendSent,
  onRemove,
  onClose,
}: {
  member: FieldTechnician | null
  avatarColor: string
  togglingActive: boolean
  plan?: RosterPlan
  showWorkspacePicker: boolean
  organizations: { id: string; name: string }[]
  movingWorkspace: boolean
  onToggleActive: () => void
  onMoveWorkspace: (orgId: string | null) => void
  onEditPay: () => void
  onEditAccess: () => void
  onEditAccount: () => void
  onResendInvite: () => void
  resendBusy: boolean
  resendSent: boolean
  onRemove: () => void
  onClose: () => void
}) {
  return (
    <Sheet open={member != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {member ? (
          <>
            <SheetHeader className="text-left">
              <div className="flex items-center gap-3">
                <Avatar className="h-11 w-11">
                  <AvatarFallback className={cn("text-sm font-semibold text-primary-foreground", avatarColor)}>
                    {initials(member.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <SheetTitle className="truncate text-base">{member.name}</SheetTitle>
                  <SheetDescription className="truncate">
                    {formatPhoneDisplay(member.phone)}
                    {member.contact_email ? ` · ${member.contact_email}` : ""}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="mt-5 space-y-2">
              {member.invite_pending ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-warning">Setup pending</p>
                    <p className="mt-0.5 text-xs text-warning/80">Hasn&rsquo;t tapped their SMS setup link yet.</p>
                  </div>
                  <button
                    type="button"
                    onClick={onResendInvite}
                    disabled={resendBusy}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-warning/40 px-2.5 py-1.5 text-2xs font-semibold text-warning transition-colors hover:bg-warning/10 disabled:opacity-60"
                  >
                    {resendBusy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Send className="h-3 w-3" aria-hidden />}
                    {resendSent ? "Sent" : "Resend"}
                  </button>
                </div>
              ) : null}

              {/* Availability */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3.5 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Active</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Shows up on the live roster and gets dispatched work.</p>
                </div>
                <Switch checked={member.is_active} disabled={togglingActive} onCheckedChange={onToggleActive} />
              </div>

              {showWorkspacePicker ? (
                <label className="block rounded-lg border border-border bg-background/40 px-3.5 py-3">
                  <span className="text-sm font-medium text-foreground">Business</span>
                  <select
                    value={member.organization_id ?? ""}
                    disabled={movingWorkspace}
                    onChange={(e) => onMoveWorkspace(e.target.value.trim() || null)}
                    className="mt-1.5 w-full rounded-md border border-border bg-card/80 px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
                  >
                    <option value="">Unassigned</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {/* Pay */}
              <button
                type="button"
                onClick={onEditPay}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-background/40 px-3.5 py-3 text-left transition-colors hover:bg-muted"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Pay</p>
                  <p className={cn("mt-0.5 truncate text-xs", plan ? "text-muted-foreground" : "text-warning")}>
                    {plan?.summary ?? "Not set — tap to set"}
                  </p>
                </div>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>

              {/* Access */}
              <button
                type="button"
                onClick={onEditAccess}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-background/40 px-3.5 py-3 text-left transition-colors hover:bg-muted"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Console access</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {grantedFieldTechLabels(member.capabilities).join(", ") || "Jobs only"}
                  </p>
                </div>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>

              {/* Account & security — email, address, password, lock */}
              <button
                type="button"
                onClick={onEditAccount}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-background/40 px-3.5 py-3 text-left transition-colors hover:bg-muted"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <ShieldCheck
                    className={cn("h-3.5 w-3.5 shrink-0", member.account_locked ? "text-destructive" : "text-muted-foreground")}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Account &amp; security</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {member.account_locked ? "Locked — can't sign in" : "Email, address, password, lock"}
                    </p>
                  </div>
                </div>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </div>

            <button
              type="button"
              onClick={onRemove}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3.5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Remove from team
            </button>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
