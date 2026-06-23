"use client"

// Phone line cards — isolated so Suspense can stream this block independently.

import { cn } from "@/lib/utils"
import { LineRoutingStatus } from "@/components/line-routing-status"
import {
  businessNumbersMatch,
  formatPhoneDisplay,
  isDashboardVisibleLineStatus,
  phoneDigits10,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import type { PortingOrder, RoutingStrategy } from "@/lib/types"

export type PhoneLinesListContentProps = {
  numbers: DashboardBusinessNumber[]
  activeLine: string | null
  activeLineDisplay: string | null
  routingStrategy: RoutingStrategy
  subscriptionActive: boolean
  lineCarrierLive: boolean
  portOrderByPhone: Map<string, PortingOrder>
  poolRouting: boolean
  onLinePress: (line: DashboardBusinessNumber) => void
  onOpenCarrierDesk: (line: DashboardBusinessNumber) => void
  onSelectLine: (line: string) => void
}

export function PhoneLinesListContent({
  numbers,
  activeLine,
  activeLineDisplay,
  routingStrategy,
  subscriptionActive,
  lineCarrierLive,
  portOrderByPhone,
  poolRouting,
  onLinePress,
  onOpenCarrierDesk,
  onSelectLine,
}: PhoneLinesListContentProps) {
  const visibleLines = numbers.filter((b) => isDashboardVisibleLineStatus(b.status))
  const hasLines = visibleLines.length > 0 || Boolean(activeLineDisplay)

  if (visibleLines.length > 0) {
    return (
      <ul className="mt-4 flex flex-col gap-2" aria-label="Your business lines">
        {visibleLines.map((line) => {
          const isActive = activeLine != null && businessNumbersMatch(line.number, activeLine)
          const label = line.label?.trim() || "Business Line"
          const portOrder = portOrderByPhone.get(phoneDigits10(line.number))
          const transferInProgress = line.status === "porting" || Boolean(portOrder)
          return (
            <li key={line.number}>
              <div
                className={cn(
                  "relative w-full overflow-hidden rounded-xl border transition-[border-color,background-color,box-shadow] duration-200",
                  isActive
                    ? poolRouting
                      ? "border-violet-500/45 bg-violet-500/5 ring-1 ring-violet-500/15"
                      : "border-primary/40 bg-primary/5 ring-1 ring-primary/15"
                    : "border-white/8 bg-neutral-950/30 hover:border-teal-500/25 hover:bg-white/[0.03]"
                )}
              >
                <button
                  type="button"
                  onClick={() => onLinePress(line)}
                  className={cn(
                    "w-full px-3 py-3 text-left transition-transform motion-safe:active:scale-[0.99]",
                    transferInProgress ? "pb-1.5" : undefined
                  )}
                >
                  <span
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      isActive
                        ? poolRouting
                          ? "text-violet-300/85"
                          : "text-primary/80"
                        : "text-muted-foreground"
                    )}
                  >
                    {label}
                  </span>
                  <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
                    {formatPhoneDisplay(line.number)}
                  </p>
                  {isActive && !transferInProgress ? (
                    <LineRoutingStatus
                      routingStrategy={routingStrategy}
                      subscriptionActive={subscriptionActive}
                      lineCarrierLive={lineCarrierLive}
                      className="mt-1"
                    />
                  ) : null}
                </button>
                {transferInProgress ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelectLine(line.number)
                      onOpenCarrierDesk(line)
                    }}
                    aria-label={`Open carrier transfer desk for ${formatPhoneDisplay(line.number)}`}
                    className="w-full px-3 pb-3 text-left text-[10px] font-medium text-amber-400/90 underline-offset-2 transition-colors hover:text-amber-300 hover:underline"
                  >
                    Transfer in progress — tap for carrier desk
                  </button>
                ) : null}
                {isActive && transferInProgress ? (
                  <div className="px-3 pb-3">
                    <LineRoutingStatus
                      routingStrategy={routingStrategy}
                      subscriptionActive={subscriptionActive}
                      lineCarrierLive={lineCarrierLive}
                    />
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  if (activeLineDisplay) {
    return (
      <div
        className={cn(
          "relative mt-4 rounded-xl border px-3 py-3 transition-colors",
          poolRouting
            ? "border-violet-500/45 bg-violet-500/5 ring-1 ring-violet-500/15"
            : "border-primary/40 bg-primary/5 ring-1 ring-primary/15"
        )}
      >
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-wider",
            poolRouting ? "text-violet-300/85" : "text-primary/80"
          )}
        >
          Active line
        </span>
        <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{activeLineDisplay}</p>
        <LineRoutingStatus
          routingStrategy={routingStrategy}
          subscriptionActive={subscriptionActive}
          lineCarrierLive={lineCarrierLive}
          className="mt-1"
        />
      </div>
    )
  }

  if (!hasLines) return null
  return null
}
