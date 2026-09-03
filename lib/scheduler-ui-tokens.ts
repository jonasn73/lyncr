// High-end dispatch UI tokens — glass cards, emerald focus, metadata hierarchy.
// Composes the global workspace standard (lib/workspace-ui-tokens.ts).

import { WS_CARD, WS_CARD_HOVER, WS_METADATA, WS_SECTION } from "@/lib/workspace-ui-tokens"

/** Frosted glass surface for cards, panels, and map chrome. */
export const SCHEDULER_GLASS_CARD = WS_CARD

/** Premium hover for tappable list cards and interactive rows. */
export const SCHEDULER_INTERACTIVE_HOVER = [
  "transition-all duration-150",
  WS_CARD_HOVER,
  "hover:shadow-[0_0_15px_rgba(16,185,129,0.05)]",
].join(" ")

/** Combined glass + hover — use on any tappable job list card. */
const SCHEDULER_JOB_CARD_SURFACE = [SCHEDULER_GLASS_CARD, SCHEDULER_INTERACTIVE_HOVER].join(
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

/** Emerald focus ring for inputs and selects in dispatch surfaces. */
const SCHEDULER_INPUT_FOCUS =
  "focus:outline-none focus:border-success focus:ring-1 focus:ring-success"

/** Standard text input inside job drawer / map popup. */
export const SCHEDULER_INPUT = [
  "w-full rounded-lg border border-border bg-card/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground",
  SCHEDULER_INPUT_FOCUS,
].join(" ")

/** Multiline notes / address fields — fixed sizing so they stay inside overflow-hidden cards. */
export const SCHEDULER_TEXTAREA = [
  "box-border block min-h-[72px] w-full min-w-0 max-w-full resize-none break-words whitespace-normal rounded-lg border border-border bg-card/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground",
  // Override shadcn Textarea `field-sizing-content` (that grows past the card edge).
  "field-sizing-fixed",
  SCHEDULER_INPUT_FOCUS,
].join(" ")

/** Grouped form block inside the job edit drawer. */
export const SCHEDULER_SECTION = [WS_SECTION, "mb-0"].join(" ")

/** Secondary action chip (Edit, Map, etc.). */
export const SCHEDULER_ACTION_BUTTON = [
  "inline-flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-foreground",
  SCHEDULER_INTERACTIVE_HOVER,
  "hover:text-foreground",
].join(" ")

/** Tappable text link (phone, edit link). */
export const SCHEDULER_INTERACTIVE_TEXT_LINK =
  "font-medium text-foreground underline decoration-slate-600 underline-offset-2 transition-all duration-150 hover:text-success hover:decoration-emerald-500/40"

/** Drawer backdrop scrim behind job detail slide-over. */
export const SCHEDULER_DRAWER_SCRIM = "bg-background/70 backdrop-blur-sm"

/** Live status strip above the dispatch board. */
export const SCHEDULER_LIVE_STATUS_SHELL = [WS_CARD, "min-w-0 overflow-hidden p-0"].join(" ")

