"use client"

// Shared chrome for public customer pages: /book, /pay, /rv (review interstitial).

import { BrandMark } from "@/components/brand-mark"
import { BrandWordmark } from "@/components/brand-wordmark"
import {
  customerPortalStepLabel,
  customerPortalStepsForMode,
  type CustomerPortalMode,
  type CustomerPortalStep,
} from "@/lib/customer-portal"
import { cn } from "@/lib/utils"

type CustomerPortalShellProps = {
  /** Business name from invite / pay link / review token (falls back to product). */
  businessName?: string | null
  /** Which journey this page belongs to — drives the step rail. */
  mode: CustomerPortalMode
  /** Highlighted step in the rail. */
  currentStep: CustomerPortalStep
  /** Optional one-line context under the business name. */
  subtitle?: string | null
  children: React.ReactNode
  className?: string
  /** Center content vertically (pay thanks / review interstitial). */
  centered?: boolean
}

export function CustomerPortalShell({
  businessName,
  mode,
  currentStep,
  subtitle,
  children,
  className,
  centered = false,
}: CustomerPortalShellProps) {
  const steps = customerPortalStepsForMode(mode)
  const title = (businessName || "").trim() || "Service request"
  const currentIndex = Math.max(0, steps.indexOf(currentStep))

  return (
    <main
      className={cn(
        "min-h-dvh bg-zinc-950 text-zinc-100",
        centered && "flex flex-col",
        className
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-lg flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-8 sm:px-6",
          centered && "flex-1 justify-center"
        )}
      >
        {/* Brand row — lyncr mark + wordmark, then business as the hero. */}
        <header className="text-center">
          <div className="inline-flex items-center gap-2 text-amber-400/90">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/30">
              <BrandMark className="h-4 w-4 text-amber-300" />
            </span>
            <BrandWordmark size="sm" variant="onDark" className="text-amber-100/90" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-sm text-zinc-400">{subtitle}</p>
          ) : null}

          {/* Step rail — Book → Pay → Done (or shorter for callback / pay / review). */}
          <ol
            className="mt-5 flex items-center justify-center gap-1.5"
            aria-label="Progress"
          >
            {steps.map((step, i) => {
              const active = i === currentIndex
              const done = i < currentIndex
              return (
                <li key={step} className="flex items-center gap-1.5">
                  {i > 0 ? (
                    <span
                      className={cn(
                        "mx-0.5 h-px w-4 sm:w-6",
                        done || active ? "bg-amber-500/60" : "bg-zinc-700"
                      )}
                      aria-hidden
                    />
                  ) : null}
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
                      active && "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40",
                      done && !active && "text-emerald-300/90",
                      !active && !done && "text-zinc-500"
                    )}
                    aria-current={active ? "step" : undefined}
                  >
                    {customerPortalStepLabel(step, mode)}
                  </span>
                </li>
              )
            })}
          </ol>
        </header>

        <div className={cn("mt-8", centered && "mt-6")}>{children}</div>
      </div>
    </main>
  )
}
