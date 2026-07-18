"use client"

// Compact price-shopper recovery + lost-lead logging for intake (step + desktop).

import { Loader2, PhoneOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { NegotiationDiscountId } from "@/lib/price-negotiation"
import {
  aftermarketRecoveryScript,
  managementFloorRecoveryScript,
  negotiationDiscountLabel,
  parseQuoteDollars,
  routeMatchRecoveryScript,
} from "@/lib/price-negotiation"
import { cn } from "@/lib/utils"

export const FAILURE_REASON_NEUTRAL = "__neutral__"

type PriceShopperRecoveryPanelProps = {
  customPrice: string
  baselineTotalCents: number
  negotiationDiscountApplied: NegotiationDiscountId | null
  quotedPriceOverridden: boolean
  failureReason: string
  onFailureReasonChange: (reason: string) => void
  negotiationStep: number
  onNegotiationStepChange: (step: number) => void
  step1Price: number
  step2Price: number
  step3Price: number
  customerName: string
  recoveredViaRouteDiscount: boolean
  onApplyRouteMatch: () => void
  onApplyAftermarket: () => void
  onApplyManagementFloor: () => void
  lostLeadState: "idle" | "saving" | "saved" | "error"
  lostLeadError: string | null
  canLogLostLead: boolean
  onLogLostLead: () => void
  compact?: boolean
  className?: string
}

export function PriceShopperRecoveryPanel({
  customPrice,
  baselineTotalCents,
  negotiationDiscountApplied,
  quotedPriceOverridden,
  failureReason,
  onFailureReasonChange,
  negotiationStep,
  onNegotiationStepChange,
  step1Price,
  step2Price,
  step3Price,
  customerName,
  recoveredViaRouteDiscount,
  onApplyRouteMatch,
  onApplyAftermarket,
  onApplyManagementFloor,
  lostLeadState,
  lostLeadError,
  canLogLostLead,
  onLogLostLead,
  compact = false,
  className,
}: PriceShopperRecoveryPanelProps) {
  const isPriceTooHigh = failureReason === "Price too high"

  return (
    <fieldset
      className={cn(
        "grid gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5",
        compact ? "p-2.5" : "p-3",
        className
      )}
    >
      <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
        Price-shopper recovery
      </legend>
      {negotiationDiscountApplied || quotedPriceOverridden ? (
        <p className="text-[11px] text-amber-100/90">
          Last pitched quote: ${parseQuoteDollars(customPrice, baselineTotalCents)}
          {negotiationDiscountApplied
            ? ` (${negotiationDiscountLabel(negotiationDiscountApplied)})`
            : ""}
          {baselineTotalCents > 0
            ? ` · baseline was $${Math.round(baselineTotalCents / 100)}`
            : ""}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="failure-reason-step" className="text-xs">
          Failure reason
        </Label>
        <Select value={failureReason} onValueChange={onFailureReasonChange}>
          <SelectTrigger id="failure-reason-step" className="h-9">
            <SelectValue placeholder="Select failure reason" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FAILURE_REASON_NEUTRAL}>— Select reason —</SelectItem>
            <SelectItem value="Price too high">Price too high</SelectItem>
            <SelectItem value="Abrupt hang-up">Abrupt hang-up</SelectItem>
            <SelectItem value="Shopping competitors">Shopping competitors</SelectItem>
            <SelectItem value="Will call back later">Will call back later</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isPriceTooHigh ? (
        <div className="mt-2 space-y-3 rounded-lg border border-orange-500/30 bg-slate-950 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-orange-300">
              Save the deal — read verbatim
            </p>
            <span className="shrink-0 text-[10px] font-medium text-orange-400/80">
              Step {negotiationStep} of 3
            </span>
          </div>

          {negotiationStep === 1 ? (
            <>
              <p className="rounded-md border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-sm leading-relaxed text-orange-50">
                &ldquo;{routeMatchRecoveryScript(step1Price)}&rdquo;
              </p>
              <Button
                type="button"
                size="lg"
                className="w-full gap-2 bg-orange-600 text-white hover:bg-orange-500"
                onClick={onApplyRouteMatch}
              >
                Apply Router Match Discount (${step1Price})
              </Button>
              <button
                type="button"
                className="w-full text-left text-xs text-orange-300 underline-offset-2 hover:text-orange-200 hover:underline"
                onClick={() => onNegotiationStepChange(2)}
              >
                Customer declined this but is still negotiating →
              </button>
              {recoveredViaRouteDiscount ? (
                <p className="text-[11px] text-emerald-300">
                  Route discount applied — confirm the job when the customer accepts.
                </p>
              ) : null}
            </>
          ) : null}

          {negotiationStep === 2 ? (
            <>
              <p className="rounded-md border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-sm leading-relaxed text-orange-50">
                &ldquo;{aftermarketRecoveryScript(step2Price)}&rdquo;
              </p>
              <Button
                type="button"
                size="lg"
                className="w-full gap-2 bg-orange-600 text-white hover:bg-orange-500"
                onClick={onApplyAftermarket}
              >
                Apply Aftermarket Hardware Swap (${step2Price})
              </Button>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  className="text-left text-xs text-slate-400 hover:text-slate-200"
                  onClick={() => onNegotiationStepChange(1)}
                >
                  ← Go Back
                </button>
                <button
                  type="button"
                  className="text-left text-xs text-orange-300 underline-offset-2 hover:text-orange-200 hover:underline"
                  onClick={() => onNegotiationStepChange(3)}
                >
                  Still too high but wants to book →
                </button>
              </div>
            </>
          ) : null}

          {negotiationStep === 3 ? (
            <>
              <p className="rounded-md border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-sm leading-relaxed text-orange-50">
                &ldquo;{managementFloorRecoveryScript(customerName, step3Price)}&rdquo;
              </p>
              <Button
                type="button"
                size="lg"
                className="w-full gap-2 bg-orange-600 text-white hover:bg-orange-500"
                onClick={onApplyManagementFloor}
              >
                Apply Final Management Floor (${step3Price})
              </Button>
              <button
                type="button"
                className="text-left text-xs text-slate-400 hover:text-slate-200"
                onClick={() => onNegotiationStepChange(2)}
              >
                ← Go Back
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full gap-2 border-amber-500/40 text-amber-100 hover:bg-amber-500/10"
        disabled={lostLeadState === "saving" || !canLogLostLead}
        onClick={onLogLostLead}
      >
        {lostLeadState === "saving" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <PhoneOff className="h-4 w-4 shrink-0" aria-hidden />
        )}
        Customer declined price / hang up
      </Button>
      {lostLeadState === "saved" ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Lost lead logged — recovery SMS will queue after 20 minutes.
        </p>
      ) : null}
      {lostLeadError ? <p className="text-xs text-red-300">{lostLeadError}</p> : null}
    </fieldset>
  )
}
