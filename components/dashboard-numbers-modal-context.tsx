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

  const openBuyModal = useCallback(() => setView("buy"), [])
  const openManageModal = useCallback(() => setView("manage"), [])
  const closeModals = useCallback(() => setView("none"), [])

  useEffect(() => {
    const onBuy = () => setView("buy")
    const onManage = () => setView("manage")
    window.addEventListener("zing-open-buy-number-modal", onBuy)
    window.addEventListener("zing-open-manage-numbers-modal", onManage)
    return () => {
      window.removeEventListener("zing-open-buy-number-modal", onBuy)
      window.removeEventListener("zing-open-manage-numbers-modal", onManage)
    }
  }, [])

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
        onBuyAnother={() => setView("buy")}
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
