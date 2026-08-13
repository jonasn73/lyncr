// Build the extra lines we append to a Help "report a problem" note.

/** Optional context from the owner's current screen (no PII beyond page path). */
export type HelpFeedbackContext = {
  /** Current browser path, e.g. /dashboard/activity */
  pagePath?: string | null
  /** Human screen name, e.g. Activity */
  pageName?: string | null
  /** Short device string, e.g. iPhone / Chrome on macOS */
  device?: string | null
}

/** Append page / device lines so admin sees where the flash happened. */
export function appendHelpContextToFeedbackBody(body: string, context?: HelpFeedbackContext | null): string {
  // Keep the owner's own words first.
  const note = body.trim()
  // Nothing extra to add.
  if (!context) return note
  // Collect non-empty meta lines in a stable order.
  const meta: string[] = []
  const pagePath = context.pagePath?.trim().slice(0, 300)
  if (pagePath) meta.push(`Page: ${pagePath}`)
  const pageName = context.pageName?.trim().slice(0, 80)
  if (pageName) meta.push(`Screen: ${pageName}`)
  const device = context.device?.trim().slice(0, 200)
  if (device) meta.push(`Device: ${device}`)
  // If the sheet sent no context, return the note unchanged.
  if (meta.length === 0) return note
  // Separate owner text from machine context with a divider.
  return [note, "", "---", ...meta].join("\n")
}

/** Best-effort device label from the browser user agent (no phone numbers). */
export function describeBrowserDevice(userAgent?: string | null): string {
  // Missing UA — still useful to know we tried.
  const ua = (userAgent ?? "").trim()
  if (!ua) return "unknown device"
  // Very small parser — enough for "iPhone" vs "Android" vs desktop browser.
  if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone / iPad"
  if (/Android/i.test(ua)) return "Android"
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac"
  if (/Windows/i.test(ua)) return "Windows"
  if (/Linux/i.test(ua)) return "Linux"
  // Fall back to a short slice so the row stays readable on /admin/support.
  return ua.slice(0, 80)
}
