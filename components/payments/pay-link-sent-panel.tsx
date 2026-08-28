"use client"

// Compact “Link sent” success — same celebratory hero language as Paid,
// but for SMS pay links (customer still needs to open and pay).

import { Check, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"

/** Format cents as US currency for the hero amount. */
function fmtCents(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })
}

/**
 * Shown right after a pay-link SMS succeeds.
 * Big check + “Link sent” + who was texted + amount, then Done / Text again.
 */
export function PayLinkSentPanel({
  phone,
  amountCents,
  linkUrl,
  onDone,
  onTextAgain,
  className,
}: {
  /** Phone number that received the SMS (raw or formatted). */
  phone: string
  /** Amount on the Checkout link (cents). */
  amountCents: number
  /** Optional Checkout URL for copy if delivery was flaky. */
  linkUrl?: string | null
  /** Primary: leave this success screen deliberately. */
  onDone: () => void
  /** Optional: reopen the text form with the same number. */
  onTextAgain?: () => void
  className?: string
}) {
  // Pretty phone for the subtitle (“Texted (502) …”).
  const phoneLabel = formatPhoneDisplay(phone) || phone.trim() || "customer"

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="relative overflow-hidden text-center">
        {/* Soft emerald wash — matches Paid hero atmosphere. */}
        <div
          className="pointer-events-none absolute inset-x-0 -top-6 h-28 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.28),_transparent_70%)] opacity-60"
          aria-hidden
        />

        <div className="relative flex flex-col items-center pt-1">
          {/* Big check as the visual star. */}
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/20 text-success shadow-[0_0_28px_-4px] shadow-success/40 ring-1 ring-success/40">
            <Check className="h-8 w-8 stroke-[2.5]" aria-hidden />
          </div>

          <p className="mt-3 text-2xs font-semibold uppercase tracking-[0.14em] text-success/80">
            Link sent
          </p>

          <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight text-white">
            {fmtCents(amountCents)}
          </p>

          <p className="mt-1.5 text-xs text-muted-foreground">
            Texted {phoneLabel}
          </p>

          <p className="mt-1 text-2xs text-muted-foreground">
            They open the link and pay — you’ll see it when it clears.
          </p>
        </div>
      </div>

      {linkUrl ? (
        <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
          <p className="break-all text-micro text-muted-foreground">{linkUrl}</p>
          <button
            type="button"
            className="mt-1.5 text-2xs font-semibold text-success underline"
            onClick={() => {
              void navigator.clipboard?.writeText(linkUrl)
            }}
          >
            Copy link
          </button>
        </div>
      ) : null}

      {onTextAgain ? (
        <button
          type="button"
          onClick={onTextAgain}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card/60 py-3 text-sm font-semibold text-foreground hover:bg-muted"
        >
          <MessageSquare className="h-4 w-4" aria-hidden />
          Text again
        </button>
      ) : null}

      <button
        type="button"
        onClick={onDone}
        className="flex w-full items-center justify-center rounded-xl bg-success py-3 text-sm font-semibold text-white hover:bg-success"
      >
        Done
      </button>
    </div>
  )
}
