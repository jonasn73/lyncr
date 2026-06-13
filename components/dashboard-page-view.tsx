"use client"

import { memo, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { PortingStatusBanner } from "@/components/dashboard/porting-status-banner"
import { PortingInteractionProvider } from "@/components/dashboard/porting-interaction-context"

export const DashboardPageView = memo(function DashboardPageView({
  children,
  animateEnter = false,
}: {
  children: ReactNode
  pathname?: string
  animateEnter?: boolean
}) {
  return (
    <PortingInteractionProvider>
      <div
        className={cn(
          "min-h-[calc(100dvh-7.5rem)] w-full bg-background px-5 pb-28 pt-5 sm:px-8 sm:pb-32 sm:pt-8",
          animateEnter && "animate-sigo-page-enter"
        )}
      >
        <PortingStatusBanner />
        {children}
      </div>
    </PortingInteractionProvider>
  )
})
