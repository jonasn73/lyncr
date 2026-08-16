// ============================================
// Browser auth helpers (dashboard + settings)
// ============================================

import { clearOperationsDataCache } from "@/lib/hooks/use-operations-data"

/** Clears the HTTP-only session cookie then navigates to login (full reload so middleware sees the cookie gone). */
export async function signOutAndGoToLogin(): Promise<void> {
  try {
    // Drop Activity paint cookie + session cache so the next account cannot see old callers.
    clearOperationsDataCache()
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
  } finally {
    window.location.assign("/login")
  }
}
