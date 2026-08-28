"use client"

import dynamic from "next/dynamic"
import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  OPEN_BILLING_MODAL_EVENT,
  OPEN_BUSINESS_PROFILE_MODAL_EVENT,
  OPEN_CARRIER_REGISTRATION_MODAL_EVENT,
  OPEN_PORT_SERVICE_ADDRESS_MODAL_EVENT,
  OPEN_ROUTING_STRATEGY_MODAL_EVENT,
  OPEN_SMS_AUTOMATION_MODAL_EVENT,
  OPEN_TEAM_INVITE_MODAL_EVENT,
  type CarrierRegistrationModalOpenDetail,
} from "@/lib/settings-modals-events"

const DashboardSettingsModalsHost = dynamic(
  () =>
    import("@/components/dashboard/settings-modals-host").then((m) => ({
      default: m.DashboardSettingsModalsHost,
    })),
  { ssr: false }
)

const MODAL_EVENTS = [
  OPEN_CARRIER_REGISTRATION_MODAL_EVENT,
  OPEN_PORT_SERVICE_ADDRESS_MODAL_EVENT,
  OPEN_SMS_AUTOMATION_MODAL_EVENT,
  OPEN_BUSINESS_PROFILE_MODAL_EVENT,
  OPEN_BILLING_MODAL_EVENT,
  OPEN_ROUTING_STRATEGY_MODAL_EVENT,
  OPEN_TEAM_INVITE_MODAL_EVENT,
] as const

const DEEP_LINK_TABS = new Set([
  "sms-registration",
  "sms-automation",
  "business-profile",
  "billing",
  "routing",
])

export type SettingsModalBootstrapEvent = {
  type: string
  detail?: CarrierRegistrationModalOpenDetail
}

/** Loads settings modal bundle on first open event or settings deep link — not on every dashboard load. */
export function DashboardSettingsModalsLazyHost({
  sessionSeed,
}: {
  sessionSeed?: {
    name: string
    email: string
    businessName: string
    companyUserId: string
  }
}) {
  const searchParams = useSearchParams()
  const tab = searchParams.get("tab")
  const deepLinkArmed = tab != null && DEEP_LINK_TABS.has(tab)

  const [armed, setArmed] = useState(deepLinkArmed)
  const [bootstrapEvent, setBootstrapEvent] = useState<SettingsModalBootstrapEvent | null>(() => {
    if (tab === "sms-registration") {
      return { type: OPEN_CARRIER_REGISTRATION_MODAL_EVENT }
    }
    return null
  })

  useEffect(() => {
    if (armed) return
    const arm = (e: Event) => {
      setBootstrapEvent({
        type: e.type,
        detail: (e as CustomEvent<CarrierRegistrationModalOpenDetail>).detail,
      })
      setArmed(true)
    }
    for (const event of MODAL_EVENTS) {
      window.addEventListener(event, arm)
    }
    return () => {
      for (const event of MODAL_EVENTS) {
        window.removeEventListener(event, arm)
      }
    }
  }, [armed])

  if (!armed) return null

  return (
    <Suspense fallback={null}>
      <DashboardSettingsModalsHost sessionSeed={sessionSeed} bootstrapEvent={bootstrapEvent} />
    </Suspense>
  )
}
