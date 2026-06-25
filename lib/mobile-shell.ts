/** Shared mobile shell dimensions — keep header/dock math in one place. */

export const MOBILE_BREAKPOINT_PX = 768

/** CSS custom properties set on the app shell root. */
export const MOBILE_SHELL_CSS_VARS = {
  headerH: "var(--shell-header-h)",
  dockH: "var(--shell-dock-h)",
} as const

/** Horizontal bleed for swipe strips inside dashboard page padding. */
export const MOBILE_BLEED =
  "-mx-4 w-[calc(100%+2rem)] sm:-mx-8 sm:w-[calc(100%+4rem)] md:mx-0 md:w-full"

/** Minimum 44×44px touch target (Apple HIG). */
export const MOBILE_TAP_TARGET = "min-h-11 min-w-11"

/** Horizontal snap scroll row for metric pills / chips. */
export const MOBILE_SNAP_ROW =
  "flex flex-nowrap overflow-x-auto snap-x snap-mandatory gap-2 scrollbar-hide [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
