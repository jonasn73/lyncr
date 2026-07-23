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

// —— Mobile Lines home chrome (Presence, stats, Who answers, Rescue, dock) ——

/** Uppercase section eyebrow used across Lines mobile blocks. */
export const LINES_MOBILE_SECTION_LABEL =
  "text-[10px] font-semibold uppercase tracking-wider text-zinc-500"

/** Default inactive / resting card surface on Lines mobile. */
export const LINES_MOBILE_CARD =
  "rounded-xl border border-zinc-800/90 bg-zinc-900/40"

/** Emerald “on / live / enabled” card tint (Presence Available, Rescue on). */
export const LINES_MOBILE_CARD_ACTIVE =
  "rounded-xl border border-emerald-500/40 bg-emerald-500/10"

/** Horizontal padding shared by sticky chrome + scroll body on phones. */
export const LINES_MOBILE_PAGE_X = "px-3"

/** Vertical rhythm between Lines mobile blocks. */
export const LINES_MOBILE_STACK = "space-y-3"

/** Left icon tile on Who answers / Rescue rows. */
export const LINES_MOBILE_ICON_TILE =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
