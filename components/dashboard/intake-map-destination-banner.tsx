"use client"

// Shared intake destination card — ETA / address / Return (Map chrome or map overlay).

import { ExternalLink } from "lucide-react"
import type { FocusDispatchMapDetail } from "@/lib/dispatch-map-focus"
import { cn } from "@/lib/utils"

export type IntakeTravelMetrics = {
  miles: number
  durationMins: number
  fromGps: boolean
  /** Where the measurement started — "metro" is a coarse city-centre guess, not the shop. */
  originSource?: "gps" | "shop" | "metro"
}

export type IntakeNearestTech = {
  name: string
  miles: number
}

type IntakeMapDestinationBannerProps = {
  destination: FocusDispatchMapDetail
  travelMetrics: IntakeTravelMetrics | null
  nearestTech: IntakeNearestTech | null
  onClear: () => void
  onReturn: () => void
  /** Map overlay floats; Map tab chrome sits in the header. */
  variant?: "chrome" | "overlay"
  className?: string
}

function formatMiles(miles: number): string {
  return miles < 10 ? miles.toFixed(1) : String(Math.round(miles))
}

export function IntakeMapDestinationBanner({
  destination,
  travelMetrics,
  nearestTech,
  onClear,
  onReturn,
  variant = "chrome",
  className,
}: IntakeMapDestinationBannerProps) {
  const mapsHref = destination.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination.address)}`
    : null

  return (
    <div
      className={cn(
        "rounded-xl border border-rose-500/50 bg-background/95 px-3 py-3 shadow-overlay backdrop-blur",
        variant === "overlay" &&
          "pointer-events-auto absolute z-[1200] max-w-[min(20rem,calc(100%-1.5rem))] left-3 top-3 sm:right-auto",
        className
      )}
      onPointerDown={variant === "overlay" ? (e) => e.stopPropagation() : undefined}
      onClick={variant === "overlay" ? (e) => e.stopPropagation() : undefined}
    >
      <p className="text-micro font-bold uppercase tracking-wider text-rose-300">Intake target</p>
      <p className="truncate text-xs font-semibold text-foreground">
        {destination.label?.trim() || "Customer location"}
      </p>
      {destination.address ? (
        <div className="mt-0.5 flex items-start gap-2">
          <p className="min-w-0 flex-1 line-clamp-2 text-2xs text-muted-foreground">
            {destination.address}
          </p>
          {mapsHref ? (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in Maps"
              aria-label="Open address in Google Maps"
              className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-sky-300"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
      ) : null}

      {travelMetrics ? (
        <div className="mt-2 space-y-0.5 border-t border-border/80 pt-2 text-micro leading-relaxed text-foreground">
          <p>
            🚗 Distance from current spot:{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {formatMiles(travelMetrics.miles)} mi
            </span>
            {travelMetrics.originSource === "shop" ? (
              <span className="text-muted-foreground"> · shop baseline</span>
            ) : !travelMetrics.fromGps ? (
              // No GPS and no saved shop address — say it is a rough city estimate rather
              // than implying it was measured from the shop.
              <span className="text-warning/80"> · rough city estimate — set your shop address</span>
            ) : null}
          </p>
          <p>
            ⏱️ Estimated Drive Time:{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {travelMetrics.durationMins} mins
            </span>
          </p>
          {nearestTech ? (
            <p className="text-warning/90">
              ⚡ Nearest available tech: {nearestTech.name} ({formatMiles(nearestTech.miles)} mi
              away)
            </p>
          ) : null}
        </div>
      ) : nearestTech ? (
        <p className="mt-2 border-t border-border/80 pt-2 text-micro text-warning/90">
          ⚡ Nearest available tech: {nearestTech.name} ({formatMiles(nearestTech.miles)} mi away)
        </p>
      ) : null}

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClear()
        }}
        className="mt-1.5 text-micro font-semibold text-rose-300/90 underline-offset-2 hover:underline"
      >
        Clear pin
      </button>
      <button
        type="button"
        data-return-to-intake=""
        onPointerDown={(e) => {
          e.stopPropagation()
        }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onReturn()
        }}
        className="mt-2 flex w-full touch-manipulation items-center justify-center rounded-lg border border-success/60 bg-success px-3 py-3 text-sm font-bold text-slate-950 shadow-[0_0_0_1px_rgba(16,185,129,0.35)] transition-colors hover:bg-success active:scale-[0.98]"
      >
        ← Return to Intake Form
      </button>
    </div>
  )
}
