"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { ChevronRight, Hash, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDashboardNumbersModal } from "@/components/dashboard-numbers-modal-context"
import { useDashboardActivationOptional } from "@/components/dashboard-activation-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { usePortingInteraction } from "@/components/dashboard/porting-interaction-context"
import { PhoneLineIntakeSheet } from "@/components/dashboard/phone-line-intake-sheet"
import { LineRoutingStatus } from "@/components/line-routing-status"
import {
  businessNumbersMatch,
  formatPhoneDisplay,
  isDashboardVisibleLineStatus,
  phoneDigits10,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import { isActivePortingOrder } from "@/lib/porting-lifecycle"
import { organizationQueryString } from "@/lib/workspace-organizations"
import type { PortingOrder, RoutingStrategy } from "@/lib/types"

export const DashboardRoutingSidebar = memo(function DashboardRoutingSidebar({
  lineCount,
  activeLineDisplay,
  routingStrategy,
  businessNumbers,
  className,
  onConfigureRouting,
}: {
  lineCount: number
  activeLineDisplay: string | null
  routingStrategy: RoutingStrategy
  businessNumbers: DashboardBusinessNumber[]
  className?: string
  onConfigureRouting?: () => void
}) {
  const { openBuyModal, openManageModal } = useDashboardNumbersModal()
  const { activeLine, setActiveLine, activeOrganizationId, businessNumbersLoading: isLoading } =
    useDashboardWorkspace()
  const { openPortingDrawer } = usePortingInteraction()
  const activation = useDashboardActivationOptional()
  const subscriptionActive = activation?.subscriptionActive === true
  const lineCarrierLive = activation?.lineCarrierLive === true
  const poolRouting = routingStrategy === "lyncr_only"
  const visibleLines = businessNumbers.filter((b) => isDashboardVisibleLineStatus(b.status))

  const [portOrders, setPortOrders] = useState<PortingOrder[]>([])
  const [intakeLine, setIntakeLine] = useState<DashboardBusinessNumber | null>(null)
  const [intakeOpen, setIntakeOpen] = useState(false)

  const loadPortOrders = useCallback(() => {
    const orgQs = organizationQueryString(activeOrganizationId)
    fetch(`/api/porting/orders${orgQs}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { data: { orders: [] } }))
      .then((data: { data?: { orders?: PortingOrder[] } }) => {
        const orders = Array.isArray(data.data?.orders) ? data.data.orders : []
        setPortOrders(orders.filter(isActivePortingOrder))
      })
      .catch(() => setPortOrders([]))
  }, [activeOrganizationId])

  useEffect(() => {
    loadPortOrders()
  }, [loadPortOrders])

  useEffect(() => {
    const onChanged = () => loadPortOrders()
    window.addEventListener("zing-porting-orders-changed", onChanged)
    return () => window.removeEventListener("zing-porting-orders-changed", onChanged)
  }, [loadPortOrders])

  const portOrderByPhone = useMemo(() => {
    const map = new Map<string, PortingOrder>()
    for (const order of portOrders) {
      map.set(phoneDigits10(order.phone_number), order)
    }
    return map
  }, [portOrders])

  const hasLines = visibleLines.length > 0 || Boolean(activeLineDisplay)
  const showLineSkeleton = isLoading && !hasLines
  const showEmptyState = !isLoading && !hasLines

  /** Open the right-side carrier desk sheet for a line in port. Refreshes orders if the map is stale. */
  const openCarrierDeskForLine = useCallback(
    async (line: DashboardBusinessNumber) => {
      const phoneKey = phoneDigits10(line.number)
      let portOrder = portOrderByPhone.get(phoneKey)
      if (portOrder?.id) {
        openPortingDrawer(portOrder.id)
        return
      }
      const orgQs = organizationQueryString(activeOrganizationId)
      try {
        const res = await fetch(`/api/porting/orders${orgQs}`, { credentials: "include" })
        if (!res.ok) return
        const data = (await res.json()) as { data?: { orders?: PortingOrder[] } }
        const orders = Array.isArray(data.data?.orders) ? data.data.orders.filter(isActivePortingOrder) : []
        setPortOrders(orders)
        portOrder = orders.find((o) => phoneDigits10(o.phone_number) === phoneKey)
        if (portOrder?.id) {
          openPortingDrawer(portOrder.id)
        }
      } catch {
        /* drawer stays closed if refresh fails */
      }
    },
    [activeOrganizationId, openPortingDrawer, portOrderByPhone]
  )

  function handleLinePress(line: DashboardBusinessNumber) {
    setActiveLine(line.number)
    const portOrder = portOrderByPhone.get(phoneDigits10(line.number))
    if (line.status === "porting" || portOrder) {
      void openCarrierDeskForLine(line)
      return
    }
    setIntakeLine(line)
    setIntakeOpen(true)
  }

  return (
    <>
      <aside
        className={cn(
          "w-full shrink-0 lg:w-56 xl:w-60",
          "rounded-2xl border border-white/8 bg-neutral-950/50 p-4 shadow-sm ring-1 ring-white/5 backdrop-blur-md",
          className
        )}
        aria-label="Phone lines"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
            <Hash className="h-4 w-4 text-primary" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Phone lines</p>
            <p className="text-[11px] text-muted-foreground">
              {showLineSkeleton ? "Loading…" : lineCount === 0 ? "No lines yet" : `${lineCount} active`}
            </p>
          </div>
        </div>

        {showLineSkeleton ? (
          <div
            className="mt-4 flex flex-col gap-2"
            aria-busy="true"
            aria-label="Loading phone lines"
          >
            <div className="h-[84px] animate-pulse rounded-xl bg-zinc-800/60" />
            <div className="h-[84px] animate-pulse rounded-xl bg-zinc-800/60" />
          </div>
        ) : visibleLines.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2" aria-label="Your business lines">
            {visibleLines.map((line) => {
              const isActive =
                activeLine != null && businessNumbersMatch(line.number, activeLine)
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
                      onClick={() => handleLinePress(line)}
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
                          setActiveLine(line.number)
                          void openCarrierDeskForLine(line)
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
        ) : activeLineDisplay ? (
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
        ) : null}

        {showEmptyState ? (
          <button
            type="button"
            onClick={openBuyModal}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--electric-glow)] transition-[opacity,transform] hover:bg-primary/90 motion-safe:active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add business number
          </button>
        ) : null}

        <nav className="mt-5 flex flex-col gap-1" aria-label="Number shortcuts">
          <button
            type="button"
            onClick={openManageModal}
            className="group flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-white/5"
          >
            <span>Lines & numbers</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </button>
          <button
            type="button"
            onClick={openBuyModal}
            className="group flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-white/5"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span>Buy / manage numbers</span>
              {hasLines && !isLoading ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/5 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  <Plus className="h-3 w-3" aria-hidden />
                  Add
                </span>
              ) : null}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </button>
        </nav>
      </aside>

      <PhoneLineIntakeSheet
        line={intakeLine}
        open={intakeOpen}
        onOpenChange={setIntakeOpen}
        routingStrategy={routingStrategy}
        subscriptionActive={subscriptionActive}
        lineCarrierLive={lineCarrierLive}
        onConfigureRouting={() => onConfigureRouting?.()}
      />
    </>
  )
})
