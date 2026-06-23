"use client"

import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useDashboardBootstrapEffective } from "@/components/dashboard-bootstrap-context"
import { useDashboardStream } from "@/components/dashboard-stream-context"
import { usePortingInteraction } from "@/components/dashboard/porting-interaction-context"
import { PhoneLinesListContent } from "@/components/dashboard/phone-lines-list-content"
import { PhoneLinesSkeleton } from "@/components/dashboard/phone-lines-skeleton"
import {
  isDashboardVisibleLineStatus,
  phoneDigits10,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import { isActivePortingOrder } from "@/lib/porting-lifecycle"
import { useBusinessNumbersSuspenseQuery } from "@/lib/hooks/use-business-numbers-query"
import { organizationQueryString } from "@/lib/workspace-organizations"
import type { PortingOrder, RoutingStrategy } from "@/lib/types"

const PhoneLineIntakeSheet = dynamic(
  () =>
    import("@/components/dashboard/phone-line-intake-sheet").then((m) => ({
      default: m.PhoneLineIntakeSheet,
    })),
  { ssr: false }
)

type PhoneLinesListContentWrapperProps = {
  numbers: DashboardBusinessNumber[]
  routingStrategy: RoutingStrategy
  activeLineDisplay: string | null
  subscriptionActive: boolean
  lineCarrierLive: boolean
  onConfigureRouting?: () => void
}

function PhoneLinesListContentWrapper({
  numbers,
  routingStrategy,
  activeLineDisplay,
  subscriptionActive,
  lineCarrierLive,
  onConfigureRouting,
}: PhoneLinesListContentWrapperProps) {
  const { activeLine, setActiveLine, activeOrganizationId } = useDashboardWorkspace()
  const { openPortingDrawer } = usePortingInteraction()
  const poolRouting = routingStrategy === "lyncr_only"

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

  const portOrderByPhone = useMemo(() => {
    const map = new Map<string, PortingOrder>()
    for (const order of portOrders) {
      map.set(phoneDigits10(order.phone_number), order)
    }
    return map
  }, [portOrders])

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
        if (portOrder?.id) openPortingDrawer(portOrder.id)
      } catch {
        /* ignore */
      }
    },
    [activeOrganizationId, openPortingDrawer, portOrderByPhone]
  )

  const handleLinePress = useCallback(
    (line: DashboardBusinessNumber) => {
      setActiveLine(line.number)
      const portOrder = portOrderByPhone.get(phoneDigits10(line.number))
      if (line.status === "porting" || portOrder) {
        void openCarrierDeskForLine(line)
        return
      }
      setIntakeLine(line)
      setIntakeOpen(true)
    },
    [openCarrierDeskForLine, portOrderByPhone, setActiveLine]
  )

  return (
    <>
      <PhoneLinesListContent
        numbers={numbers}
        activeLine={activeLine}
        activeLineDisplay={activeLineDisplay}
        routingStrategy={routingStrategy}
        subscriptionActive={subscriptionActive}
        lineCarrierLive={lineCarrierLive}
        portOrderByPhone={portOrderByPhone}
        poolRouting={poolRouting}
        onLinePress={handleLinePress}
        onOpenCarrierDesk={(line) => void openCarrierDeskForLine(line)}
        onSelectLine={setActiveLine}
      />
      {intakeOpen ? (
        <PhoneLineIntakeSheet
          line={intakeLine}
          open={intakeOpen}
          onOpenChange={setIntakeOpen}
          routingStrategy={routingStrategy}
          subscriptionActive={subscriptionActive}
          lineCarrierLive={lineCarrierLive}
          onConfigureRouting={() => onConfigureRouting?.()}
        />
      ) : null}
    </>
  )
}

function PhoneLinesSwrInner(props: Omit<PhoneLinesListContentWrapperProps, "numbers">) {
  const { activeOrganizationId } = useDashboardWorkspace()
  const { numbers } = useBusinessNumbersSuspenseQuery(activeOrganizationId)
  return <PhoneLinesListContentWrapper numbers={numbers} {...props} />
}

function PhoneLinesStreamInner({
  numbersPromise,
  ...props
}: Omit<PhoneLinesListContentWrapperProps, "numbers"> & {
  numbersPromise: Promise<DashboardBusinessNumber[]>
}) {
  const numbers = use(numbersPromise)
  const { setBusinessNumbers, setBusinessNumbersLoading } = useDashboardWorkspace()

  useEffect(() => {
    setBusinessNumbers(numbers)
    setBusinessNumbersLoading(false)
  }, [numbers, setBusinessNumbers, setBusinessNumbersLoading])

  return <PhoneLinesListContentWrapper numbers={numbers} {...props} />
}

export type PhoneLinesListProps = Omit<PhoneLinesListContentWrapperProps, "numbers">

/** Suspends until phone lines resolve — wrap in `<Suspense fallback={<PhoneLinesSkeleton />}>`. */
export function PhoneLinesList(props: PhoneLinesListProps) {
  const bootstrap = useDashboardBootstrapEffective()
  const { businessNumbers } = useDashboardWorkspace()
  const { phoneLinesPromise } = useDashboardStream()

  const seededNumbers =
    bootstrap?.phoneLines.length ? bootstrap.phoneLines : businessNumbers.length > 0 ? businessNumbers : null

  if (seededNumbers) {
    return <PhoneLinesListContentWrapper numbers={seededNumbers} {...props} />
  }

  if (phoneLinesPromise) {
    return <PhoneLinesStreamInner numbersPromise={phoneLinesPromise} {...props} />
  }

  return <PhoneLinesSwrInner {...props} />
}

/** Self-contained list with its own Suspense boundary (e.g. outside the routing sidebar). */
export function PhoneLinesListWithSuspense(props: PhoneLinesListProps) {
  return (
    <Suspense fallback={<PhoneLinesSkeleton />}>
      <PhoneLinesList {...props} />
    </Suspense>
  )
}

export function phoneLinesSubtitle(numbers: DashboardBusinessNumber[], loading: boolean): string {
  if (loading) return "Loading…"
  const count = numbers.filter((b) => isDashboardVisibleLineStatus(b.status)).length
  if (count === 0) return "No lines yet"
  return `${count} active`
}

export function phoneLinesHasLines(
  numbers: DashboardBusinessNumber[],
  activeLineDisplay: string | null
): boolean {
  const visible = numbers.filter((b) => isDashboardVisibleLineStatus(b.status))
  return visible.length > 0 || Boolean(activeLineDisplay)
}
