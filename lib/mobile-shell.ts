/** Shared mobile shell dimensions — keep header/dock math in one place. */

export const MOBILE_BREAKPOINT_PX = 768

/**
 * Full-height tab body (map, boards) — viewport minus shell chrome and the page
 * padding DashboardPageView owns (pt-4/pb-8 = 3rem, sm:pt-8/sm:pb-10 = 4.5rem).
 * --shell-dock-h already folds in the safe-area inset, so this needs no extra term.
 */
export const WORKSPACE_VIEWPORT_H =
  "h-[calc(100dvh-var(--shell-header-h)-var(--shell-dock-h)-3rem)] sm:h-[calc(100dvh-var(--shell-header-h)-var(--shell-dock-h)-4.5rem)]"

/** Horizontal bleed for swipe strips inside dashboard page padding. */
export const MOBILE_BLEED =
  "-mx-4 w-[calc(100%+2rem)] sm:-mx-8 sm:w-[calc(100%+4rem)] md:mx-0 md:w-full"

/** Minimum 44×44px touch target (Apple HIG). */
export const MOBILE_TAP_TARGET = "min-h-11 min-w-11"

// —— Mobile Lines home chrome (Presence, stats, Who answers, Rescue, dock) ——

/** Uppercase section eyebrow used across Lines mobile blocks. */
export const LINES_MOBILE_SECTION_LABEL =
  "text-micro font-semibold uppercase tracking-wider text-muted-foreground"

/** Default inactive / resting card surface on Lines mobile. */
export const LINES_MOBILE_CARD =
  "rounded-xl border border-border/90 bg-card/40"

