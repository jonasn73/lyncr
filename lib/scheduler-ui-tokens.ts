// High-end dispatch UI tokens — glass cards, emerald focus, metadata hierarchy.
// Composes the global workspace standard (lib/workspace-ui-tokens.ts).

import {
  WS_CARD,
  WS_CARD_ACTIVE,
  WS_CARD_HOVER,
  WS_GAP,
  WS_ICON_ACTIVE,
  WS_ICON_INACTIVE,
  WS_METADATA,
  WS_OPTION_ROW,
  WS_OPTION_ROW_ACTIVE,
  WS_ROW,
  WS_SECTION,
  WS_SPEC_ROW,
  WS_STACK,
  WS_TEXT,
  WS_TEXT_ACTIVE,
} from "@/lib/workspace-ui-tokens"

export {
  WS_CARD,
  WS_CARD_ACTIVE,
  WS_CARD_HOVER,
  WS_GAP,
  WS_ICON_ACTIVE,
  WS_ICON_INACTIVE,
  WS_METADATA,
  WS_OPTION_ROW,
  WS_OPTION_ROW_ACTIVE,
  WS_ROW,
  WS_SECTION,
  WS_SPEC_ROW,
  WS_STACK,
  WS_TEXT,
  WS_TEXT_ACTIVE,
}

/** Frosted glass surface for cards, panels, and map chrome. */
export const SCHEDULER_GLASS_CARD = WS_CARD

/** Premium hover for tappable list cards and interactive rows. */
export const SCHEDULER_INTERACTIVE_HOVER = [
  "transition-all duration-150",
  WS_CARD_HOVER,
  "hover:shadow-[0_0_15px_rgba(16,185,129,0.05)]",
].join(" ")

/** Combined glass + hover — use on any tappable job list card. */
export const SCHEDULER_JOB_CARD_SURFACE = [SCHEDULER_GLASS_CARD, SCHEDULER_INTERACTIVE_HOVER].join(
  " "
)

/** Hopper tickets, pipeline rows, and sidebar job cards. */
export const SCHEDULER_LIST_CARD_SHELL = [
  "relative w-full text-left",
  SCHEDULER_JOB_CARD_SURFACE,
].join(" ")

/** Section headings and field metadata labels. */
export const SCHEDULER_METADATA_LABEL = WS_METADATA

/** Strict vertical hierarchy for label + value pairs. */
export const SCHEDULER_FIELD_STACK = "flex flex-col gap-1"

/** Primary value line under a metadata label. */
export const SCHEDULER_FIELD_VALUE = "text-sm font-medium leading-snug text-slate-200"

/** Emerald focus ring for inputs and selects in dispatch surfaces. */
export const SCHEDULER_INPUT_FOCUS =
  "focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"

/** Standard text input inside job drawer / map popup. */
export const SCHEDULER_INPUT = [
  "w-full rounded-lg border border-slate-850 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500",
  SCHEDULER_INPUT_FOCUS,
].join(" ")

/** Multiline notes / address fields. */
export const SCHEDULER_TEXTAREA = [
  "box-border block min-h-[72px] w-full max-w-full resize-none break-words whitespace-normal rounded-lg border border-slate-850 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500",
  SCHEDULER_INPUT_FOCUS,
].join(" ")

/** Grouped form block inside the job edit drawer. */
export const SCHEDULER_SECTION = [WS_SECTION, "mb-0"].join(" ")

/** Compact spec tile — horizontal metadata row. */
export const SCHEDULER_SPEC_TILE = WS_SPEC_ROW

/** Secondary action chip (Edit, Map, etc.). */
export const SCHEDULER_ACTION_BUTTON = [
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-850 bg-slate-900/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300",
  SCHEDULER_INTERACTIVE_HOVER,
  "hover:text-slate-100",
].join(" ")

/** Tappable text link (phone, edit link). */
export const SCHEDULER_INTERACTIVE_TEXT_LINK =
  "font-medium text-slate-100 underline decoration-slate-600 underline-offset-2 transition-all duration-150 hover:text-emerald-300 hover:decoration-emerald-500/40"

/** Map marker hover tooltip. */
export const SCHEDULER_MAP_TOOLTIP = [WS_CARD, "px-2.5 py-1.5 text-xs text-slate-200 shadow-xl"].join(
  " "
)

/** Desktop map popup shell. */
export const SCHEDULER_MAP_POPUP_SHELL = [WS_CARD, "w-[300px] p-4"].join(" ")

/** Mobile floating map toolbar. */
export const SCHEDULER_MOBILE_TOOLBAR = [
  "rounded-2xl border border-slate-850 bg-slate-900/40 shadow-lg backdrop-blur-md",
].join(" ")

/** Mobile bottom job sheet. */
export const SCHEDULER_MOBILE_SHEET = [
  "border-t border-slate-850 bg-slate-900/40 shadow-[0_-12px_40px_rgba(0,0,0,0.55)] backdrop-blur-md",
].join(" ")

/** Drawer backdrop scrim behind job detail slide-over. */
export const SCHEDULER_DRAWER_SCRIM = "bg-slate-950/70 backdrop-blur-sm"

/** Live status strip above the dispatch board. */
export const SCHEDULER_LIVE_STATUS_SHELL = [WS_CARD, "min-w-0 overflow-hidden p-0"].join(" ")

/** Unified gap utility for scheduler panels. */
export const SCHEDULER_GAP = WS_GAP

/** Vertical panel stack. */
export const SCHEDULER_STACK = WS_STACK
