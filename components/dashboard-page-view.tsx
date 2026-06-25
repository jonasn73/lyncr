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
          "min-h-[calc(100dvh-3.5rem)] w-full max-w-full bg-background px-4 pb-6 pt-4 sm:min-h-[calc(100dvh-4rem)] sm:px-8 sm:pb-10 sm:pt-8",
          animateEnter && "animate-sigo-page-enter"
        )}
      >
        {children}
      </div>
    </PortingInteractionProvider>
  )
})
