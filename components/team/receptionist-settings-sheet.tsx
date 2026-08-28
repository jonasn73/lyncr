"use client"

// One settings surface per person — tapping a name in Team opens this instead of hunting
// across scattered row buttons (Pay here, Access there, a switch, a trash icon). Pay and
// Access still open their existing editors (PayPlanEditor / ReceptionistAccessEditor) on
// top of this sheet — their forms are non-trivial enough to keep as-is rather than
// reimplement inline — but everything about one person now starts from one tap.

import { Pencil, Trash2 } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { grantedCapabilityLabels } from "@/lib/receptionist-capabilities"
import type { Receptionist, ReceptionistPayoutMetrics } from "@/lib/types"
import type { RosterPlan } from "@/components/compensation/pay-plan-editor"

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

export function ReceptionistSettingsSheet({
  member,
  avatarColor,
  online,
  togglingActive,
  plan,
  payout,
  onToggleActive,
  onEditPay,
  onEditAccess,
  onRemove,
  onClose,
}: {
  member: Receptionist | null
  avatarColor: string
  online: boolean
  togglingActive: boolean
  plan?: RosterPlan
  payout?: ReceptionistPayoutMetrics
  onToggleActive: () => void
  onEditPay: () => void
  onEditAccess: () => void
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
                <div className="relative">
                  <Avatar className="h-11 w-11">
                    <AvatarFallback className={cn("text-sm font-semibold text-primary-foreground", avatarColor)}>
                      {initials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background",
                      online ? "bg-success" : "bg-muted-foreground"
                    )}
                    aria-hidden
                  />
                </div>
                <div className="min-w-0">
                  <SheetTitle className="truncate text-base">{member.name}</SheetTitle>
                  <SheetDescription className="truncate">{formatPhoneDisplay(member.phone)}</SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="mt-5 space-y-2">
              {/* Availability */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3.5 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Available</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Can take calls when picked in Who answers.</p>
                </div>
                <Switch checked={online} disabled={togglingActive} onCheckedChange={onToggleActive} />
              </div>

              {/* Pay */}
              <button
                type="button"
                onClick={onEditPay}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-background/40 px-3.5 py-3 text-left transition-colors hover:bg-muted"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Pay</p>
                  <p
                    className={cn(
                      "mt-0.5 truncate text-xs",
                      plan ? "text-muted-foreground" : "text-warning"
                    )}
                  >
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
                  {/* Reads the shared label map rather than naming flags here. Listing them
                      by hand is how this line came to say "Default" for capabilities that
                      were in fact granted — it only knew the two that existed when it was
                      written. */}
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {grantedCapabilityLabels(member.capabilities).join(", ") || "No access granted yet"}
                  </p>
                </div>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>

              {/* Payout, when there's something to show */}
              {payout ? (
                <div className="rounded-lg border border-border bg-background/40 px-3.5 py-3">
                  <p className="text-sm font-medium text-foreground">This billing cycle</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {payout.answered_calls} call{payout.answered_calls === 1 ? "" : "s"} ·{" "}
                    <span className="font-medium text-foreground">{formatUsd(payout.total_earnings)} earned</span>
                  </p>
                </div>
              ) : null}
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
