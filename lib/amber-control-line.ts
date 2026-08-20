// Amber control DID helpers — bot helper line, not a customer-facing shop number.

/** Canonical Settings label for the Amber control number. */
export const AMBER_CONTROL_LINE_LABEL = "Amber · Lyncr"

type AmberLineLike = {
  is_amber_control?: boolean | null
  label?: string | null
}

/** True when this row is the Amber · Lyncr bot helper DID (not a shop line). */
export function isAmberControlLine(line: AmberLineLike | null | undefined): boolean {
  if (!line) return false
  if (line.is_amber_control === true) return true
  const label = (line.label ?? "").trim().toLowerCase()
  // Match the Settings product name even when the DB flag is missing on paint cookies.
  return label === "amber · lyncr"
}

/** Shop lines only — drop Amber so Lines never treats the bot DID like Business Line. */
export function customerFacingPhoneLines<T extends AmberLineLike>(lines: T[]): T[] {
  return lines.filter((line) => !isAmberControlLine(line))
}
