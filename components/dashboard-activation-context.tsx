"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import {
  fetchOnboardingProfile,
  fetchOnboardingProvisionMode,
  startStripeSubscriptionCheckout,
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
  billingCycleEnd: string | null
  reservedDisplay: string | null
  simulationMode: boolean
  refreshProfile: (opts?: { silent?: boolean }) => Promise<void>
  applyActivatedProfile: (profile: OnboardingProfile) => void
  requestLineActivation: () => Promise<void>
}

const DashboardActivationContext = createContext<DashboardActivationContextValue | null>(null)

export function DashboardActivationProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast()
  const searchParams = useSearchParams()
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

  const redirectToStripeCheckout = useCallback(async () => {
    const { checkoutUrl } = await startStripeSubscriptionCheckout()
    window.location.href = checkoutUrl
  }, [])

  const requestLineActivation = useCallback(async () => {
    if (activating) return
    if (profile?.has_billing_method) {
      setActivating(true)
      try {
        await redirectToStripeCheckout()
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not start checkout"
        toast({ variant: "destructive", title: "Checkout failed", description: msg })
        setActivating(false)
      }
      return
    }
    setModalOpen(true)
  }, [activating, profile?.has_billing_method, redirectToStripeCheckout, toast])

  useEffect(() => {
    void refreshProfile()
  }, [refreshProfile])

  useEffect(() => {
    const onActivated = () => void refreshProfile()
    window.addEventListener(SUBSCRIPTION_ACTIVATED_EVENT, onActivated)
    return () => window.removeEventListener(SUBSCRIPTION_ACTIVATED_EVENT, onActivated)
  }, [refreshProfile])

  useEffect(() => {
    const checkout = searchParams.get("stripe_checkout")
    if (checkout === "success") {
      toast({
        title: "Payment received",
        description: "Your subscription is activating. This may take a moment while we provision your line.",
      })
      void refreshProfile({ silent: true })
      window.history.replaceState({}, "", "/dashboard")
    } else if (checkout === "cancelled") {
      toast({
        title: "Checkout cancelled",
        description: "Your line is still in trial mode until you complete payment.",
      })
      window.history.replaceState({}, "", "/dashboard")
    }
  }, [searchParams, refreshProfile, toast])

  const reservedDisplay =
    profile?.reserved_number_display?.trim() || profile?.reserved_number?.trim() || null

  const subscriptionActive = profile?.has_active_subscription === true
  const hasBillingMethod = profile?.has_billing_method === true
  const showTrialBanner = Boolean(reservedDisplay) && !subscriptionActive
  const billingCycleEnd = profile?.billing_cycle_end?.trim() || null

  const value = useMemo(
    (): DashboardActivationContextValue => ({
      profile,
      loading,
      activating,
      subscriptionActive,
      hasBillingMethod,
      showTrialBanner,
      lineCarrierLive: carrierLive,
      billingCycleEnd,
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
      billingCycleEnd,
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
        onContinueToCheckout={redirectToStripeCheckout}
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
