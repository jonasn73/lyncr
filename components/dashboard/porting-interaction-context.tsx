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
import { PortingInteractionDrawer } from "@/components/dashboard/porting-interaction-drawer"

type PortingInteractionContextValue = {
  openPortingDrawer: (orderId: string) => void
  closePortingDrawer: () => void
  activeOrderId: string | null
}

const PortingInteractionContext = createContext<PortingInteractionContextValue | null>(null)

export function requestOpenPortingInteractionDrawer(orderId?: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("lyncr-open-porting-drawer", { detail: { orderId: orderId ?? null } })
    )
  }
}

export function PortingInteractionProvider({ children }: { children: ReactNode }) {
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const openPortingDrawer = useCallback((orderId: string) => {
    setActiveOrderId(orderId)
    setDrawerOpen(true)
  }, [])

  const closePortingDrawer = useCallback(() => {
    setDrawerOpen(false)
  }, [])

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ orderId?: string | null }>).detail
      if (detail?.orderId) openPortingDrawer(detail.orderId)
    }
    window.addEventListener("lyncr-open-porting-drawer", onOpen)
    return () => window.removeEventListener("lyncr-open-porting-drawer", onOpen)
  }, [openPortingDrawer])

  const value = useMemo(
    () => ({ openPortingDrawer, closePortingDrawer, activeOrderId }),
    [openPortingDrawer, closePortingDrawer, activeOrderId]
  )

  return (
    <PortingInteractionContext.Provider value={value}>
      {children}
      <PortingInteractionDrawer
        orderId={activeOrderId}
        open={drawerOpen}
        onOpenChange={(open) => {
          if (!open) closePortingDrawer()
        }}
      />
    </PortingInteractionContext.Provider>
  )
}

export function usePortingInteraction(): PortingInteractionContextValue {
  const ctx = useContext(PortingInteractionContext)
  if (!ctx) {
    throw new Error("usePortingInteraction must be used within PortingInteractionProvider")
  }
  return ctx
}
