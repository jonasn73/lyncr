// Global workspace layout tokens — premium, spacious, unified across intake + scheduler.

/**
 * Card surface (idle).
 * Note: slate-850 is registered in app/globals.css @theme (between slate-800 and slate-900).
 */
export const WS_CARD =
  "bg-slate-900/40 backdrop-blur-md border border-slate-850 rounded-xl p-3 text-left transition-all duration-150"

/** Card when selected / active. Compose with WS_CARD. */
export const WS_CARD_ACTIVE =
  "border-emerald-500/50 bg-slate-900/80 shadow-[0_0_15px_rgba(16,185,129,0.04)]"

/** Soft hover for tappable cards (compose with WS_CARD when not active). */
export const WS_CARD_HOVER =
  "hover:border-emerald-500/30 hover:bg-slate-900/60"

/** Combined interactive option row (idle + hover). */
export const WS_OPTION_ROW = [WS_CARD, WS_CARD_HOVER].join(" ")

/** Selected option row. */
export const WS_OPTION_ROW_ACTIVE = [WS_CARD, WS_CARD_ACTIVE].join(" ")

/** Metadata / secondary labels (YMM chips, field captions, timing flags). */
export const WS_METADATA =
  "text-[11px] font-semibold tracking-wider uppercase text-slate-500"

/** Interactive primary text on cards and option rows. */
export const WS_TEXT = "text-xs font-medium text-slate-300"

/** Selected interactive text. */
export const WS_TEXT_ACTIVE = "text-xs font-medium text-emerald-100"

/** Icons — active (selected). */
export const WS_ICON_ACTIVE = "h-4 w-4 shrink-0 text-emerald-400"

/** Icons — inactive / resting. */
export const WS_ICON_INACTIVE = "h-4 w-4 shrink-0 text-slate-500"

/** Standard gap between sibling layout blocks. */
export const WS_GAP = "gap-3"

/** Vertical stack with unified breathing room. */
export const WS_STACK = "flex flex-col gap-3"

/** Horizontal flex row for lightweight option cards. */
export const WS_ROW = "flex flex-row items-center gap-3"

/** Section shell inside drawers / intake steps. */
export const WS_SECTION = [
  WS_CARD,
  "min-w-0 max-w-full overflow-hidden",
].join(" ")

/** Compact horizontal spec / metadata row. */
export const WS_SPEC_ROW = [
  WS_CARD,
  "flex flex-row items-center justify-between gap-3",
].join(" ")
