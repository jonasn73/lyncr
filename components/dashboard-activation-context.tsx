"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  activateSubscriptionClient,
  fetchOnboardingProfile,
  fetchOnboardingProvisionMode,
  type OnboardingProvisionMode,
} from "@/lib/onboarding-profile-client"
import type { OnboardingProfile } from "@/lib/types"
import { ActivateLineModal } from "@/components/activate-line-modal"
import { useToast } from "@/hooks/use-toast"

export const SUBSCRIPTION_ACTIVATED_EVENT = "zing-subscription-activated"

type DashboardActivationContextValue = {
  profile: OnboardingProfile | null
  loading: boolean
  activating: boolean
  subscriptionActive: boolean
  hasBillingMethod: boolean
  showTrialBanner: boolean
  lineCarrierLive: boolean
  reservedDisplay: string | null
  simulationMode: boolean
  refreshProfile: (opts?: { silent?: boolean }) => Promise<void>
  applyActivatedProfile: (profile: OnboardingProfile) => void
  /** One-click activate when billing on file; otherwise opens card modal. */
  requestLineActivation: () => Promise<void>
}

const DashboardActivationContext = createContext<DashboardActivationContextValue | null>(null)

export function DashboardActivationProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast()
  const [profile, setProfile] = useState<OnboardingProfile | null>(null)
  const [carrierLive, setCarrierLive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [provisionMode, setProvisionMode] = useState<OnboardingProvisionMode>({
    simulation_mode: true,
    notice: null,
  })

  const refreshProfile = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const [snapshot, mode] = await Promise.all([fetchOnboardingProfile(), fetchOnboardingProvisionMode()])
      setProfile(snapshot.profile)
      setCarrierLive(snapshot.carrierLive)
      setProvisionMode(mode)
    } catch {
      if (!opts?.silent) {
        setProfile(null)
        setCarrierLive(false)
      }
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  const applyActivatedProfile = useCallback((activated: OnboardingProfile) => {
    setProfile(activated)
  }, [])

  const completeActivation = useCallback(
    async (saveBillingMethod: boolean) => {
      const result = await activateSubscriptionClient({ saveBillingMethod })
      applyActivatedProfile(result.profile)
      toast({
        title: result.profile.has_active_subscription ? "Line activated" : "Activation incomplete",
        description: result.message,
      })
      await refreshProfile({ silent: true })
      window.dispatchEvent(new Event(SUBSCRIPTION_ACTIVATED_EVENT))
      return result
    },
    [applyActivatedProfile, refreshProfile, toast]
  )

  const requestLineActivation = useCallback(async () => {
    if (activating) return
    if (profile?.has_billing_method) {
      setActivating(true)
      try {
        await completeActivation(false)
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Activation failed"
        toast({ variant: "destructive", title: "Could not activate line", description: msg })
      } finally {
        setActivating(false)
      }
      return
    }
    setModalOpen(true)
  }, [activating, completeActivation, profile?.has_billing_method, toast])

  useEffect(() => {
    void refreshProfile()
  }, [refreshProfile])

  useEffect(() => {
    const onActivated = () => void refreshProfile()
    window.addEventListener(SUBSCRIPTION_ACTIVATED_EVENT, onActivated)
    return () => window.removeEventListener(SUBSCRIPTION_ACTIVATED_EVENT, onActivated)
  }, [refreshProfile])

  const reservedDisplay =
    profile?.reserved_number_display?.trim() || profile?.reserved_number?.trim() || null

  const subscriptionActive = profile?.has_active_subscription === true
  const hasBillingMethod = profile?.has_billing_method === true
  const showTrialBanner = Boolean(reservedDisplay) && !subscriptionActive

  const value = useMemo(
    (): DashboardActivationContextValue => ({
      profile,
      loading,
      activating,
      subscriptionActive,
      hasBillingMethod,
      showTrialBanner,
      lineCarrierLive: carrierLive,
      reservedDisplay,
      simulationMode: provisionMode.simulation_mode,
      refreshProfile,
      applyActivatedProfile,
      requestLineActivation,
    }),
    [
      profile,
      loading,
      activating,
      subscriptionActive,
      hasBillingMethod,
      showTrialBanner,
      carrierLive,
      reservedDisplay,
      provisionMode.simulation_mode,
      refreshProfile,
      applyActivatedProfile,
      requestLineActivation,
    ]
  )

  return (
    <DashboardActivationContext.Provider value={value}>
      {children}
      <ActivateLineModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        reservedDisplay={reservedDisplay}
        onActivated={async (activatedProfile) => {
          applyActivatedProfile(activatedProfile)
          await refreshProfile({ silent: true })
          window.dispatchEvent(new Event(SUBSCRIPTION_ACTIVATED_EVENT))
        }}
        onSubmitActivation={async () => completeActivation(true)}
      />
    </DashboardActivationContext.Provider>
  )
}

export function useDashboardActivation(): DashboardActivationContextValue {
  const ctx = useContext(DashboardActivationContext)
  if (!ctx) {
    throw new Error("useDashboardActivation must be used within DashboardActivationProvider")
  }
  return ctx
}

export function useDashboardActivationOptional(): DashboardActivationContextValue | null {
  return useContext(DashboardActivationContext)
}
