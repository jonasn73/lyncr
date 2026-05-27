"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { BuyNumberMarketplaceModal } from "@/components/buy-number-marketplace-modal"
import { ManageNumbersModal } from "@/components/manage-numbers-modal"
import { fetchNumberEntitlements } from "@/lib/number-entitlements-client"
import { showUpgradeSubscriptionModal } from "@/components/upgrade-subscription-modal"
import { showAddCarrierCreditModal } from "@/components/add-carrier-credit-modal"
import { useToast } from "@/hooks/use-toast"

export type NumbersModalView = "none" | "buy" | "manage"

type DashboardNumbersModalContextValue = {
  openBuyModal: () => void
  openManageModal: () => void
  closeModals: () => void
}

const DashboardNumbersModalContext = createContext<DashboardNumbersModalContextValue | null>(null)

export function dispatchBusinessNumbersChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("zing-business-numbers-changed"))
  }
}

export function requestOpenBuyNumberModal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("zing-open-buy-number-modal"))
  }
}

export function requestOpenManageNumbersModal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("zing-open-manage-numbers-modal"))
  }
}

export function DashboardNumbersModalProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<NumbersModalView>("none")
  const { toast } = useToast()

  const openBuyModal = useCallback(async () => {
    try {
      const entitlements = await fetchNumberEntitlements()
      if (!entitlements.allowed) {
        if (entitlements.reason === "insufficient_credit") {
          showAddCarrierCreditModal({
            message: entitlements.message ?? undefined,
            carrierCredit: entitlements.carrier_credit,
            provisioningFeeUsd: entitlements.provisioning_fee_usd,
          })
          return
        }
        if (entitlements.reason === "tier_limit") {
          showUpgradeSubscriptionModal({
            message: entitlements.message ?? undefined,
            currentTier: entitlements.subscription_tier as import("@/lib/subscription-tier").SubscriptionTier,
            suggestedTier:
              (entitlements.upgrade_target_tier as import("@/lib/subscription-checkout").CheckoutSubscriptionTier | null) ??
              undefined,
            subscriptionActive: entitlements.subscription_active,
          })
          return
        }
        toast({
          title: "Cannot add number",
          description: entitlements.message ?? "You cannot add another business number on your current plan.",
          variant: "destructive",
        })
        return
      }
      setView("buy")
    } catch (e) {
      toast({
        title: "Could not open number shop",
        description: e instanceof Error ? e.message : "Try again in a moment.",
        variant: "destructive",
      })
    }
  }, [toast])
  const openManageModal = useCallback(() => setView("manage"), [])
  const closeModals = useCallback(() => setView("none"), [])

  useEffect(() => {
    const onBuy = () => {
      void openBuyModal()
    }
    const onManage = () => setView("manage")
    window.addEventListener("zing-open-buy-number-modal", onBuy)
    window.addEventListener("zing-open-manage-numbers-modal", onManage)
    return () => {
      window.removeEventListener("zing-open-buy-number-modal", onBuy)
      window.removeEventListener("zing-open-manage-numbers-modal", onManage)
    }
  }, [openBuyModal])

  const value = useMemo(
    () => ({ openBuyModal, openManageModal, closeModals }),
    [openBuyModal, openManageModal, closeModals]
  )

  return (
    <DashboardNumbersModalContext.Provider value={value}>
      {children}
      <BuyNumberMarketplaceModal
        open={view === "buy"}
        onOpenChange={(open) => !open && closeModals()}
        onOpenManage={() => setView("manage")}
      />
      <ManageNumbersModal
        open={view === "manage"}
        onOpenChange={(open) => !open && closeModals()}
        onBuyAnother={() => void openBuyModal()}
      />
    </DashboardNumbersModalContext.Provider>
  )
}

export function useDashboardNumbersModal(): DashboardNumbersModalContextValue {
  const ctx = useContext(DashboardNumbersModalContext)
  if (!ctx) {
    throw new Error("useDashboardNumbersModal must be used within DashboardNumbersModalProvider")
  }
  return ctx
}

/** Safe hook for command palette — no-op when outside provider. */
export function useDashboardNumbersModalOptional(): DashboardNumbersModalContextValue | null {
  return useContext(DashboardNumbersModalContext)
}
