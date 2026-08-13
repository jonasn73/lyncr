// Tiny browser event so Settings + header can open the same Help sheet.

/** CustomEvent name dispatched on `window` to open the owner Help sheet. */
export const OPEN_OWNER_HELP_SHEET_EVENT = "lyncr-open-owner-help"

/** Optional tab the sheet should land on. */
export type OwnerHelpSheetTab = "chat" | "report"

/** Fire from any dashboard button — the sheet host listens in dashboard-shell. */
export function openOwnerHelpSheet(tab: OwnerHelpSheetTab = "chat"): void {
  // Server components cannot open a sheet.
  if (typeof window === "undefined") return
  // Same pattern as closeHeaderSettings / openGetPaidModal.
  window.dispatchEvent(
    new CustomEvent(OPEN_OWNER_HELP_SHEET_EVENT, {
      detail: { tab },
    })
  )
}
