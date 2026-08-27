"use client"

// Shared chrome for public customer pages: /book, /b, /pay, /rv (review interstitial).

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
  /**
   * Tighter header + padding for phone book forms so Details fits above the fold.
   * Desktop keeps a bit more breathing room.
   */
  compact?: boolean
}

export function CustomerPortalShell({
  businessName,
  mode,
  currentStep,
  subtitle,
  children,
  className,
  centered = false,
  compact = false,
}: CustomerPortalShellProps) {
  const steps = customerPortalStepsForMode(mode)
  const title = (businessName || "").trim() || "Service request"
  const currentIndex = Math.max(0, steps.indexOf(currentStep))

  return (
    <main
      className={cn(
        // Match Lyncr app chrome: dark slate + teal accents (not gold-only orphan).
        "min-h-dvh bg-zinc-950 text-zinc-100",
        centered && "flex flex-col",
        className
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-lg flex-col px-4 sm:px-6",
          compact
            ? "pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 sm:pt-6"
            : "pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-8",
          centered && "flex-1 justify-center"
        )}
      >
        <header className="text-center">
          <div
            className={cn(
              "inline-flex items-center gap-2 text-teal-300/90",
              compact && "scale-90 origin-center"
            )}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/15 ring-1 ring-teal-500/35">
              <BrandMark className="h-4 w-4 text-teal-300" />
            </span>
            <BrandWordmark size="sm" variant="onDark" className="text-teal-50/90" />
          </div>
          <h1
            className={cn(
              "font-semibold tracking-tight text-white",
              compact
                ? "mt-1.5 text-lg sm:mt-3 sm:text-2xl"
                : "mt-4 text-2xl sm:text-3xl"
            )}
          >
            {title}
          </h1>
          {subtitle ? (
            <p
              className={cn(
                "text-sm text-zinc-400",
                compact ? "mt-1 hidden sm:block" : "mt-2"
              )}
            >
              {subtitle}
            </p>
          ) : null}

          <ol
            className={cn(
              "flex items-center justify-center gap-2",
              compact ? "mt-2.5 sm:mt-4" : "mt-5"
            )}
            aria-label="Progress"
          >
            {steps.map((step, i) => {
              const active = i === currentIndex
              const done = i < currentIndex
              return (
                <li key={step} className="flex items-center gap-2">
                  {i > 0 ? (
                    <span
                      className={cn(
                        "mx-0.5 h-px w-4 sm:w-6",
                        done || active ? "bg-teal-500/60" : "bg-zinc-700"
                      )}
                      aria-hidden
                    />
                  ) : null}
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                      active && "bg-teal-500/20 text-teal-100 ring-1 ring-teal-500/40",
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

        <div className={cn(compact ? "mt-3 sm:mt-6" : "mt-8", centered && "mt-6")}>
          {children}
        </div>
      </div>
    </main>
  )
}
