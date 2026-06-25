"use client"

import { memo, type ReactNode } from "react"
import { cn } from "@/lib/utils"
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
          "min-h-[calc(100dvh-var(--shell-header-h)-var(--shell-dock-h))] w-full max-w-full bg-background px-4 pb-8 pt-4 max-md:min-h-0 max-md:overflow-x-hidden sm:px-8 sm:pb-10 sm:pt-8 md:min-h-[calc(100dvh-4rem)]",
          animateEnter && "animate-sigo-page-enter"
        )}
      >
        {children}
      </div>
    </PortingInteractionProvider>
  )
})
