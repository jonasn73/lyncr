"use client"

import { memo } from "react"
import { CheckCircle2, Phone, Settings2 } from "lucide-react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { WORKSPACE_SHEET_CLASS } from "@/lib/workspace-sheet-classes"
import { DrawerScrollBody, DrawerStepHeader } from "@/components/dashboard-routing-drawer-shared"
import { LineRoutingStatus } from "@/components/line-routing-status"
import {
  formatPhoneDisplay,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import type { RoutingStrategy } from "@/lib/types"

type PhoneLineIntakeSheetProps = {
  line: DashboardBusinessNumber | null
  open: boolean
  onOpenChange: (open: boolean) => void
  routingStrategy: RoutingStrategy
  subscriptionActive: boolean
  lineCarrierLive: boolean
  onConfigureRouting: () => void
}

export const PhoneLineIntakeSheet = memo(function PhoneLineIntakeSheet({
  line,
  open,
  onOpenChange,
  routingStrategy,
  subscriptionActive,
  lineCarrierLive,
  onConfigureRouting,
}: PhoneLineIntakeSheetProps) {
  const label = line?.label?.trim() || "Business Line"
  const display = line ? formatPhoneDisplay(line.number) : ""

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent side="right" variant="drawer" className={WORKSPACE_SHEET_CLASS}>
        {/* DrawerStepHeader renders a plain h2 — name the sheet for screen readers. */}
        <SheetTitle className="sr-only">Phone line settings</SheetTitle>
        <DrawerStepHeader
          step="Phone line"
          title={label}
          subtitle="Live carrier status and routing for this business number."
          lineLabel={display}
        />
        <DrawerScrollBody className="space-y-6">
          {line ? (
            <>
              <div className="rounded-xl border border-white/8 bg-neutral-950/60 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-teal-500/30 bg-teal-500/10">
                    <Phone className="h-4 w-4 text-teal-300" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{display}</p>
                    <LineRoutingStatus
                      routingStrategy={routingStrategy}
                      subscriptionActive={subscriptionActive}
                      lineCarrierLive={lineCarrierLive}
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-success/20 bg-success/5 p-4">
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                  <p className="text-xs font-semibold uppercase tracking-wide">Carrier status</p>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  This line is provisioned on the carrier and ready for inbound call routing. Open the call flow
                  to choose who answers and what happens when no one picks up.
                </p>
              </div>

              {line.routing_summary ? (
                <div className="rounded-xl border border-white/8 bg-neutral-950/50 p-4 text-sm text-muted-foreground">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Routing snapshot</p>
                  <ul className="mt-2 space-y-2">
                    <li>
                      Fallback:{" "}
                      <span className="font-medium text-foreground">
                        {line.routing_summary.fallback_type}
                      </span>
                    </li>
                    <li>
                      AI fallback:{" "}
                      <span className="font-medium text-foreground">
                        {line.routing_summary.ai_fallback_live ? "Live" : "Off"}
                      </span>
                    </li>
                  </ul>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  onOpenChange(false)
                  onConfigureRouting()
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--electric-glow)] transition-transform hover:bg-primary/90 motion-safe:active:scale-[0.98]"
              >
                <Settings2 className="h-4 w-4" aria-hidden />
                Configure call flow
              </button>
            </>
          ) : null}
        </DrawerScrollBody>
      </SheetContent>
    </Sheet>
  )
})
