// High-end dispatch UI tokens — glass cards, emerald focus, metadata hierarchy.
// Used by job drawer, map layout, hopper cards, and active pipeline panels.

/** Frosted glass surface for cards, panels, and map chrome. */
export const SCHEDULER_GLASS_CARD =
  "rounded-xl border border-slate-800/80 bg-slate-900/60 backdrop-blur-md"

/** Premium hover for tappable list cards and interactive rows. */
export const SCHEDULER_INTERACTIVE_HOVER =
  "transition-all duration-200 hover:border-emerald-500/40 hover:bg-slate-900/90 hover:shadow-[0_0_15px_rgba(16,185,129,0.05)]"

/** Combined glass + hover — use on any tappable job list card. */
export const SCHEDULER_JOB_CARD_SURFACE = [SCHEDULER_GLASS_CARD, SCHEDULER_INTERACTIVE_HOVER].join(" ")

/** Hopper tickets, pipeline rows, and sidebar job cards. */
export const SCHEDULER_LIST_CARD_SHELL = [
  "relative w-full text-left",
  SCHEDULER_JOB_CARD_SURFACE,
].join(" ")

/** Section headings and field metadata labels. */
export const SCHEDULER_METADATA_LABEL =
  "text-[10px] font-semibold uppercase tracking-wider text-slate-500"

/** Strict vertical hierarchy for label + value pairs. */
export const SCHEDULER_FIELD_STACK = "flex flex-col gap-1"

/** Primary value line under a metadata label. */
export const SCHEDULER_FIELD_VALUE = "text-sm font-medium leading-snug text-foreground"

/** Emerald focus ring for inputs and selects in dispatch surfaces. */
export const SCHEDULER_INPUT_FOCUS =
  "focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"

/** Standard text input inside job drawer / map popup. */
export const SCHEDULER_INPUT = [
  "w-full rounded-lg border border-slate-800/80 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500",
  SCHEDULER_INPUT_FOCUS,
].join(" ")

/** Multiline notes / address fields. */
export const SCHEDULER_TEXTAREA = [
  "box-border block min-h-[72px] w-full max-w-full resize-none break-words whitespace-normal rounded-lg border border-slate-800/80 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500",
  SCHEDULER_INPUT_FOCUS,
].join(" ")

/** Grouped form block inside the job edit drawer. */
export const SCHEDULER_SECTION = [SCHEDULER_GLASS_CARD, "mb-4 min-w-0 max-w-full overflow-hidden p-4"].join(
  " "
)

/** Compact spec tile in job overview (YMM, FCC, address, etc.). */
export const SCHEDULER_SPEC_TILE = [SCHEDULER_GLASS_CARD, "px-3 py-2.5"].join(" ")

/** Secondary action chip (Edit, Map, etc.). */
export const SCHEDULER_ACTION_BUTTON = [
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-800/80 bg-slate-900/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300",
  SCHEDULER_INTERACTIVE_HOVER,
  "hover:text-slate-100",
].join(" ")

/** Tappable text link (phone, edit link). */
export const SCHEDULER_INTERACTIVE_TEXT_LINK =
  "font-medium text-slate-100 underline decoration-slate-600 underline-offset-2 transition-all duration-200 hover:text-emerald-300 hover:decoration-emerald-500/40"

/** Map marker hover tooltip. */
export const SCHEDULER_MAP_TOOLTIP = [
  SCHEDULER_GLASS_CARD,
  "px-2.5 py-1.5 text-xs text-slate-200 shadow-xl",
].join(" ")

/** Desktop map popup shell. */
export const SCHEDULER_MAP_POPUP_SHELL = [SCHEDULER_GLASS_CARD, "w-[300px] p-4"].join(" ")

/** Mobile floating map toolbar. */
export const SCHEDULER_MOBILE_TOOLBAR = [
  "rounded-2xl border border-slate-800/80 bg-slate-900/60 shadow-lg backdrop-blur-md",
].join(" ")

/** Mobile bottom job sheet. */
export const SCHEDULER_MOBILE_SHEET = [
  "border-t border-slate-800/80 bg-slate-900/60 shadow-[0_-12px_40px_rgba(0,0,0,0.55)] backdrop-blur-md",
].join(" ")

/** Drawer backdrop scrim behind job detail slide-over. */
export const SCHEDULER_DRAWER_SCRIM = "bg-slate-950/70 backdrop-blur-sm"

/** Live status strip above the dispatch board. */
export const SCHEDULER_LIVE_STATUS_SHELL = [
  SCHEDULER_GLASS_CARD,
  "min-w-0 overflow-hidden",
].join(" ")
