"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import {
  fetchOnboardingProfile,
  fetchOnboardingProvisionMode,
  confirmStripeSubscriptionAfterCheckout,
  startStripeSubscriptionCheckout,
  type OnboardingProvisionMode,
} from "@/lib/onboarding-profile-client"
import type { OnboardingProfile } from "@/lib/types"
import { isVerifiedActiveSubscription } from "@/lib/onboarding-subscription-status"
import { useToast } from "@/hooks/use-toast"

export const SUBSCRIPTION_ACTIVATED_EVENT = "zing-subscription-activated"

type DashboardActivationContextValue = {
  profile: OnboardingProfile | null
  loading: boolean
  activating: boolean
  subscriptionActive: boolean
  showTrialBanner: boolean
  lineCarrierLive: boolean
  billingCycleEnd: string | null
  reservedDisplay: string | null
  simulationMode: boolean
  refreshProfile: (opts?: { silent?: boolean }) => Promise<void>
  applyActivatedProfile: (profile: OnboardingProfile) => void
  /** Opens live Stripe Checkout when subscription is not active. */
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

  const requestLineActivation = useCallback(async () => {
    if (activating) return
    if (isVerifiedActiveSubscription(profile, carrierLive)) return

    setActivating(true)
    try {
      const { checkoutUrl } = await startStripeSubscriptionCheckout()
      window.location.href = checkoutUrl
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start checkout"
      toast({ variant: "destructive", title: "Checkout failed", description: msg })
      setActivating(false)
    }
  }, [activating, profile, carrierLive, toast])

  const reservedDisplay =
    profile?.reserved_number_display?.trim() || profile?.reserved_number?.trim() || null

  const subscriptionActive = isVerifiedActiveSubscription(profile, carrierLive)
  const showTrialBanner = Boolean(reservedDisplay) && !subscriptionActive
  const billingCycleEnd = profile?.billing_cycle_end?.trim() || null

  useEffect(() => {
    void refreshProfile()
  }, [refreshProfile])

  useEffect(() => {
    const onActivated = () => void refreshProfile()
    window.addEventListener(SUBSCRIPTION_ACTIVATED_EVENT, onActivated)
    return () => window.removeEventListener(SUBSCRIPTION_ACTIVATED_EVENT, onActivated)
  }, [refreshProfile])

  useEffect(() => {
    if (loading || subscriptionActive || !profile?.reserved_number) return
    if (sessionStorage.getItem("lyncr-stripe-recover")) return
    sessionStorage.setItem("lyncr-stripe-recover", "1")
    void (async () => {
      try {
        await confirmStripeSubscriptionAfterCheckout()
        await refreshProfile({ silent: true })
      } catch {
        sessionStorage.removeItem("lyncr-stripe-recover")
      }
    })()
  }, [loading, subscriptionActive, profile?.reserved_number, refreshProfile])

  useEffect(() => {
    const checkout = searchParams.get("stripe_checkout")
    const sessionId = searchParams.get("session_id")
    if (checkout === "success") {
      void (async () => {
        try {
          await confirmStripeSubscriptionAfterCheckout(sessionId)
          toast({
            title: "Payment received",
            description: "Your subscription is active. Provisioning your line may take a moment.",
          })
          await refreshProfile({ silent: true })
        } catch {
          try {
            await confirmStripeSubscriptionAfterCheckout()
            toast({
              title: "Payment received",
              description: "Your subscription is now linked to your account.",
            })
            await refreshProfile({ silent: true })
          } catch {
            toast({
              title: "Payment received",
              description:
                "We could not sync automatically yet. Refresh in a minute or contact support if trial mode persists.",
            })
          }
        }
        window.history.replaceState({}, "", "/dashboard")
      })()
    } else if (checkout === "cancelled") {
      toast({
        title: "Checkout cancelled",
        description: "Your line is still in trial mode until you complete payment.",
      })
      window.history.replaceState({}, "", "/dashboard")
    }
  }, [searchParams, refreshProfile, toast])

  const value = useMemo(
    (): DashboardActivationContextValue => ({
      profile,
      loading,
      activating,
      subscriptionActive,
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
    <DashboardActivationContext.Provider value={value}>{children}</DashboardActivationContext.Provider>
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
