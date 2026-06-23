"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import {
  fetchOnboardingProfile,
  fetchOnboardingProvisionMode,
  confirmStripeSubscriptionAfterCheckout,
  provisionLineAfterPayment,
  reserveAndProvisionLine,
  startStripeSubscriptionCheckout,
  type OnboardingProvisionMode,
} from "@/lib/onboarding-profile-client"
import type { CheckoutSubscriptionTier } from "@/lib/subscription-checkout"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import type { OnboardingProfile } from "@/lib/types"
import {
  hasPaidStripeSubscription,
  isVerifiedActiveSubscription,
  needsLineProvisioning,
  needsStripeSubscriptionCheckout,
} from "@/lib/onboarding-subscription-status"
import { useToast } from "@/hooks/use-toast"
import { ReplaceUnavailableLineModal } from "@/components/replace-unavailable-line-modal"
import { dispatchBusinessNumbersChanged } from "@/components/dashboard-numbers-modal-context"
import { extractUsAreaCode } from "@/lib/provision-line-types"

export const SUBSCRIPTION_ACTIVATED_EVENT = "zing-subscription-activated"

type ReplaceLinePrompt = {
  unavailableDisplay: string
  areaCode: string
} | null

type ProvisionError = Error & {
  reason?: string
  unavailable_number?: string
  area_code?: string
}

function asProvisionError(e: unknown): ProvisionError {
  if (e instanceof Error) return e as ProvisionError
  return new Error(String(e)) as ProvisionError
}

type DashboardActivationContextValue = {
  profile: OnboardingProfile | null
  loading: boolean
  activating: boolean
  subscriptionActive: boolean
  showTrialBanner: boolean
  showProvisioningBanner: boolean
  lineCarrierLive: boolean
  billingCycleEnd: string | null
  reservedDisplay: string | null
  simulationMode: boolean
  refreshProfile: (opts?: { silent?: boolean }) => Promise<void>
  applyActivatedProfile: (profile: OnboardingProfile) => void
  requestLineActivation: (tier?: CheckoutSubscriptionTier) => Promise<void>
}

const DashboardActivationContext = createContext<DashboardActivationContextValue | null>(null)

export type DashboardActivationSeed = {
  subscriptionActive: boolean
  lineCarrierLive: boolean
}

export function DashboardActivationProvider({
  children,
  activationSeed,
}: {
  children: ReactNode
  activationSeed?: DashboardActivationSeed
}) {
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const [profile, setProfile] = useState<OnboardingProfile | null>(null)
  const [carrierLive, setCarrierLive] = useState(() => activationSeed?.lineCarrierLive ?? false)
  const [loading, setLoading] = useState(() => !activationSeed)
  const [activating, setActivating] = useState(false)
  const [checkoutTier, setCheckoutTier] = useState<CheckoutSubscriptionTier>("starter")
  const [replacePrompt, setReplacePrompt] = useState<ReplaceLinePrompt>(null)
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

  const openReplacePicker = useCallback((err: ProvisionError, fallbackDisplay: string | null) => {
    const unavailable =
      err.unavailable_number?.trim() ||
      profile?.reserved_number?.trim() ||
      ""
    const areaCode =
      err.area_code?.trim() ||
      extractUsAreaCode(unavailable) ||
      "502"
    setReplacePrompt({
      unavailableDisplay:
        fallbackDisplay ||
        formatPhoneDisplay(unavailable) ||
        "Your reserved number",
      areaCode,
    })
  }, [profile?.reserved_number])

  const handleProvisionSuccess = useCallback(
    async (phoneNumber: string, opts?: { alreadyLive?: boolean; showToast?: boolean }) => {
      if (opts?.showToast !== false && !opts?.alreadyLive) {
        toast({
          title: "Line activated",
          description: `${formatPhoneDisplay(phoneNumber)} is now live on the Lyncr network.`,
        })
      }
      dispatchBusinessNumbersChanged()
      await refreshProfile({ silent: true })
    },
    [toast, refreshProfile]
  )

  const runProvision = useCallback(
    async (opts?: { phone_number?: string; silent?: boolean }) => {
      const result = await provisionLineAfterPayment(opts)
      await handleProvisionSuccess(result.phone_number, {
        alreadyLive: result.already_live,
        showToast: !opts?.silent,
      })
      return result
    },
    [handleProvisionSuccess]
  )

  const handleProvisionFailure = useCallback(
    (e: unknown, fallbackDisplay: string | null) => {
      const err = asProvisionError(e)
      if (err.reason === "number_unavailable") {
        sessionStorage.removeItem("lyncr-line-provision")
        openReplacePicker(err, fallbackDisplay)
        toast({
          title: "Number unavailable",
          description: "Your reserved line is no longer available. Pick a replacement — you won't be charged until one is purchased.",
        })
        return
      }
      const msg = err.message || "Could not provision your business line."
      const needsCredit = /carrier credit/i.test(msg)
      toast({
        variant: needsCredit ? "default" : "destructive",
        title: needsCredit ? "Add carrier credit on Pay" : "Line not live yet",
        description: needsCredit
          ? "Your subscription is active. Add at least $2 carrier credit on the Pay tab — we will activate your line automatically after payment."
          : msg,
      })
    },
    [openReplacePicker, toast]
  )

  const reservedDisplay =
    profile?.reserved_number_display?.trim() || profile?.reserved_number?.trim() || null

  const requestLineActivation = useCallback(async (tier: CheckoutSubscriptionTier = checkoutTier) => {
    if (activating) return
    if (carrierLive) return

    setActivating(true)
    try {
      if ((needsLineProvisioning(profile, carrierLive) || hasPaidStripeSubscription(profile)) && !carrierLive) {
        try {
          await runProvision()
        } catch (e) {
          handleProvisionFailure(e, reservedDisplay)
        }
        return
      }

      if (profile?.has_active_subscription && needsStripeSubscriptionCheckout(profile, carrierLive)) {
        try {
          await confirmStripeSubscriptionAfterCheckout()
          await refreshProfile({ silent: true })
          const snapshot = await fetchOnboardingProfile()
          if (snapshot.profile?.stripe_subscription_id?.trim()) {
            try {
              await runProvision()
            } catch (e) {
              handleProvisionFailure(e, reservedDisplay)
            }
            toast({
              title: "Subscription linked",
              description: "We found your payment and started provisioning your line.",
            })
            return
          }
        } catch {
          // Fall through to fresh checkout below.
        }
      }

      if (!needsStripeSubscriptionCheckout(profile, carrierLive)) {
        return
      }

      const result = await startStripeSubscriptionCheckout(tier)
      if (result.kind === "upgraded") {
        toast({
          title: `Upgraded to ${result.tierLabel}`,
          description: "Your plan was updated.",
        })
        return
      }
      window.location.href = result.checkoutUrl
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start checkout"
      const needsCredit = /carrier credit/i.test(msg)
      toast({
        variant: needsCredit ? "default" : "destructive",
        title: needsCredit ? "Add carrier credit on Pay" : "Activation failed",
        description: needsCredit
          ? "Your subscription is already paid. Open the Pay tab and add carrier credit to activate your line."
          : msg,
      })
    } finally {
      setActivating(false)
    }
  }, [
    activating,
    profile,
    carrierLive,
    checkoutTier,
    toast,
    refreshProfile,
    runProvision,
    handleProvisionFailure,
    reservedDisplay,
  ])

  const subscriptionActive =
    loading && activationSeed
      ? activationSeed.subscriptionActive
      : isVerifiedActiveSubscription(profile, carrierLive)
  const lineCarrierLive =
    loading && activationSeed
      ? activationSeed.lineCarrierLive
      : carrierLive
  const showTrialBanner = Boolean(reservedDisplay) && !subscriptionActive
  const showProvisioningBanner = Boolean(reservedDisplay) && subscriptionActive && !carrierLive
  const billingCycleEnd = profile?.billing_cycle_end?.trim() || null

  useEffect(() => {
    void refreshProfile({ silent: Boolean(activationSeed) })
  }, [refreshProfile, activationSeed])

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
    if (loading || !profile?.reserved_number || carrierLive || !subscriptionActive) return
    if (sessionStorage.getItem("lyncr-line-provision")) return
    sessionStorage.setItem("lyncr-line-provision", "1")
    void (async () => {
      try {
        const snapshot = await fetchOnboardingProfile()
        if (snapshot.carrierLive) {
          setCarrierLive(true)
          return
        }
        await runProvision({ silent: true })
      } catch (e) {
        sessionStorage.removeItem("lyncr-line-provision")
        handleProvisionFailure(e, reservedDisplay)
      }
    })()
  }, [
    loading,
    profile?.reserved_number,
    carrierLive,
    subscriptionActive,
    runProvision,
    handleProvisionFailure,
    reservedDisplay,
  ])

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
      showProvisioningBanner,
      lineCarrierLive,
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
      showProvisioningBanner,
      lineCarrierLive,
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
      <ReplaceUnavailableLineModal
        open={replacePrompt != null}
        onOpenChange={(open) => {
          if (!open) setReplacePrompt(null)
        }}
        unavailableDisplay={replacePrompt?.unavailableDisplay ?? "Your reserved number"}
        areaCode={replacePrompt?.areaCode ?? "502"}
        onConfirmLine={async (line) => {
          const { phone_number } = await reserveAndProvisionLine({
            reserved_number: line.number,
            reserved_number_display: line.display,
          })
          setReplacePrompt(null)
          await handleProvisionSuccess(phone_number)
        }}
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
