"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  OPEN_BILLING_MODAL_EVENT,
  OPEN_GET_PAID_MODAL_EVENT,
  OPEN_BUSINESS_PROFILE_MODAL_EVENT,
  OPEN_CARRIER_REGISTRATION_MODAL_EVENT,
  OPEN_PORT_SERVICE_ADDRESS_MODAL_EVENT,
  OPEN_ROUTING_STRATEGY_MODAL_EVENT,
  OPEN_SMS_AUTOMATION_MODAL_EVENT,
  OPEN_TEAM_INVITE_MODAL_EVENT,
  type CarrierRegistrationModalOpenDetail,
} from "@/lib/settings-modals-events"
import { CarrierRegistrationModal } from "@/components/dashboard/carrier-registration-modal"
import { PortServiceAddressModal } from "@/components/dashboard/port-service-address-modal"
import { SmsAutomationModal } from "@/components/dashboard/sms-automation-modal"
import { BusinessProfileModal } from "@/components/dashboard/business-profile-modal"
import { BillingSubscriptionModal } from "@/components/dashboard/billing-subscription-modal"
import { RoutingStrategyModal } from "@/components/dashboard/routing-strategy-modal"
import { TeamInviteModal } from "@/components/team-invite-modal"
import { fetchOnboardingProfile } from "@/lib/onboarding-profile-client"
import { isVerifiedActiveSubscription } from "@/lib/onboarding-subscription-status"
import type { SettingsModalBootstrapEvent } from "@/components/dashboard/settings-modals-lazy-host"

export type SettingsModalsProfile = {
  name: string
  email: string
  businessName: string
  companyUserId: string
  smsLeadsEnabled: boolean
  dispatchSmsPhone: string
  emailRecordingsEnabled: boolean
  subscriptionActive: boolean
  billingCycleEnd: string | null
}

const EMPTY_PROFILE: SettingsModalsProfile = {
  name: "",
  email: "",
  businessName: "",
  companyUserId: "",
  smsLeadsEnabled: false,
  dispatchSmsPhone: "",
  emailRecordingsEnabled: false,
  subscriptionActive: false,
  billingCycleEnd: null,
}

/** Mounted once under the dashboard shell so banner + settings rows share the same modals. */
export function DashboardSettingsModalsHost({
  sessionSeed,
  bootstrapEvent = null,
}: {
  sessionSeed?: {
    name: string
    email: string
    businessName: string
    companyUserId: string
  }
  bootstrapEvent?: SettingsModalBootstrapEvent | null
}) {
  const searchParams = useSearchParams()
  const [profile, setProfile] = useState<SettingsModalsProfile>(() =>
    sessionSeed
      ? {
          ...EMPTY_PROFILE,
          name: sessionSeed.name,
          email: sessionSeed.email,
          businessName: sessionSeed.businessName,
          companyUserId: sessionSeed.companyUserId,
        }
      : EMPTY_PROFILE
  )
  const [carrierOpen, setCarrierOpen] = useState(false)
  const [carrierInitialEdit, setCarrierInitialEdit] = useState(false)
  const [portAddressOpen, setPortAddressOpen] = useState(false)
  const [smsAutomationOpen, setSmsAutomationOpen] = useState(false)
  const [businessOpen, setBusinessOpen] = useState(false)
  const [billingOpen, setBillingOpen] = useState(false)
  const [routingOpen, setRoutingOpen] = useState(false)
  const [teamInviteOpen, setTeamInviteOpen] = useState(false)

  const refreshProfile = useCallback(async () => {
    try {
      let next: SettingsModalsProfile = sessionSeed
        ? {
            ...EMPTY_PROFILE,
            name: sessionSeed.name,
            email: sessionSeed.email,
            businessName: sessionSeed.businessName,
            companyUserId: sessionSeed.companyUserId,
          }
        : { ...EMPTY_PROFILE }

      if (!sessionSeed) {
        const sessionRes = await fetch("/api/auth/session", { credentials: "include" })
        const sessionJson = sessionRes.ok ? await sessionRes.json() : null
        const u = sessionJson?.data?.user
        next = {
          ...EMPTY_PROFILE,
          name: String(u?.name ?? ""),
          email: String(u?.email ?? ""),
          companyUserId: String(u?.id ?? ""),
          businessName: String(u?.business_name ?? "").trim() || "My Business",
        }
      }
      try {
        const { profile: ob, carrierLive } = await fetchOnboardingProfile()
        next = {
          ...next,
          subscriptionActive: isVerifiedActiveSubscription(ob, carrierLive),
          billingCycleEnd: ob?.billing_cycle_end?.trim() || null,
          smsLeadsEnabled: ob?.sms_leads_enabled === true,
          dispatchSmsPhone: ob?.dispatch_sms_phone?.trim() || "",
        }
      } catch {
        /* optional */
      }
      const recRes = await fetch("/api/settings/email-recordings", { credentials: "include" })
      if (recRes.ok) {
        const recJson = await recRes.json()
        next.emailRecordingsEnabled = recJson?.data?.email_recordings_enabled === true
      }
      setProfile(next)
    } catch {
      /* non-fatal */
    }
  }, [sessionSeed])

  const openCarrierFromEvent = useCallback(
    (e?: Event | SettingsModalBootstrapEvent) => {
      const detail =
        e && "detail" in e
          ? (e.detail as CarrierRegistrationModalOpenDetail | undefined)
          : (e as CustomEvent<CarrierRegistrationModalOpenDetail> | undefined)?.detail
      void refreshProfile()
      setCarrierInitialEdit(detail?.edit === true)
      setCarrierOpen(true)
    },
    [refreshProfile]
  )

  const openCarrier = useCallback(() => openCarrierFromEvent(), [openCarrierFromEvent])
  const openPortAddress = useCallback(() => setPortAddressOpen(true), [])
  const openSmsAutomation = useCallback(() => setSmsAutomationOpen(true), [])
  const openBusiness = useCallback(() => {
    void refreshProfile()
    setBusinessOpen(true)
  }, [refreshProfile])
  const openBilling = useCallback(() => {
    void refreshProfile()
    setBillingOpen(true)
  }, [refreshProfile])
  const openRouting = useCallback(() => setRoutingOpen(true), [])
  const openTeamInvite = useCallback(() => setTeamInviteOpen(true), [])

  useEffect(() => {
    const handlers: [string, (e: Event) => void][] = [
      [OPEN_CARRIER_REGISTRATION_MODAL_EVENT, openCarrierFromEvent],
      [OPEN_PORT_SERVICE_ADDRESS_MODAL_EVENT, openPortAddress],
      [OPEN_SMS_AUTOMATION_MODAL_EVENT, openSmsAutomation],
      [OPEN_BUSINESS_PROFILE_MODAL_EVENT, openBusiness],
      [OPEN_BILLING_MODAL_EVENT, openBilling],
      [OPEN_ROUTING_STRATEGY_MODAL_EVENT, openRouting],
      [OPEN_TEAM_INVITE_MODAL_EVENT, openTeamInvite],
    ]
    for (const [event, fn] of handlers) {
      window.addEventListener(event, fn)
    }
    return () => {
      for (const [event, fn] of handlers) {
        window.removeEventListener(event, fn)
      }
    }
  }, [openCarrierFromEvent, openPortAddress, openSmsAutomation, openBusiness, openBilling, openRouting, openTeamInvite])

  useEffect(() => {
    if (!bootstrapEvent) return
    // Get paid is owned by the header wallet (always mounted) — skip here.
    if (bootstrapEvent.type === OPEN_GET_PAID_MODAL_EVENT) return
    const map: Record<string, () => void> = {
      [OPEN_CARRIER_REGISTRATION_MODAL_EVENT]: () => openCarrierFromEvent(bootstrapEvent),
      [OPEN_PORT_SERVICE_ADDRESS_MODAL_EVENT]: openPortAddress,
      [OPEN_SMS_AUTOMATION_MODAL_EVENT]: openSmsAutomation,
      [OPEN_BUSINESS_PROFILE_MODAL_EVENT]: openBusiness,
      [OPEN_BILLING_MODAL_EVENT]: openBilling,
      [OPEN_ROUTING_STRATEGY_MODAL_EVENT]: openRouting,
      [OPEN_TEAM_INVITE_MODAL_EVENT]: openTeamInvite,
    }
    map[bootstrapEvent.type]?.()
  }, [bootstrapEvent, openCarrierFromEvent, openPortAddress, openSmsAutomation, openBusiness, openBilling, openRouting, openTeamInvite])

  useEffect(() => {
    const tab = searchParams.get("tab")
    if (tab === "sms-registration") openCarrier()
    if (tab === "sms-automation") openSmsAutomation()
    if (tab === "business-profile") openBusiness()
    if (tab === "billing") openBilling()
    if (tab === "routing") openRouting()
  }, [searchParams, openCarrier, openSmsAutomation, openBusiness, openBilling, openRouting])

  return (
    <>
      <CarrierRegistrationModal
        open={carrierOpen}
        onOpenChange={(open) => {
          setCarrierOpen(open)
          if (!open) setCarrierInitialEdit(false)
        }}
        initialEdit={carrierInitialEdit}
      />
      <PortServiceAddressModal open={portAddressOpen} onOpenChange={setPortAddressOpen} />
      <SmsAutomationModal open={smsAutomationOpen} onOpenChange={setSmsAutomationOpen} />
      <BusinessProfileModal
        open={businessOpen}
        onOpenChange={setBusinessOpen}
        initialName={profile.name}
        initialEmail={profile.email}
        initialBusinessName={profile.businessName}
        initialSmsLeadsEnabled={profile.smsLeadsEnabled}
        initialDispatchSmsPhone={profile.dispatchSmsPhone}
        initialEmailRecordingsEnabled={profile.emailRecordingsEnabled}
        companyUserId={profile.companyUserId}
      />
      <BillingSubscriptionModal
        open={billingOpen}
        onOpenChange={setBillingOpen}
        subscriptionActive={profile.subscriptionActive}
        billingCycleEnd={profile.billingCycleEnd}
      />
      <RoutingStrategyModal open={routingOpen} onOpenChange={setRoutingOpen} />
      <TeamInviteModal open={teamInviteOpen} onOpenChange={setTeamInviteOpen} />
    </>
  )
}

export function useSettingsModalActions() {
  return {
    openCarrierRegistration: () => {
      window.dispatchEvent(new CustomEvent(OPEN_CARRIER_REGISTRATION_MODAL_EVENT))
    },
    openSmsAutomation: () => {
      window.dispatchEvent(new CustomEvent(OPEN_SMS_AUTOMATION_MODAL_EVENT))
    },
    openBusinessProfile: () => {
      window.dispatchEvent(new CustomEvent(OPEN_BUSINESS_PROFILE_MODAL_EVENT))
    },
    openBilling: () => {
      window.dispatchEvent(new CustomEvent(OPEN_BILLING_MODAL_EVENT))
    },
    openGetPaid: () => {
      window.dispatchEvent(new CustomEvent(OPEN_GET_PAID_MODAL_EVENT))
    },
    openRoutingStrategy: () => {
      window.dispatchEvent(new CustomEvent(OPEN_ROUTING_STRATEGY_MODAL_EVENT))
    },
  }
}
