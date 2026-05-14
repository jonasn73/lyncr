// ============================================
// Browser auth helpers (dashboard + settings)
// ============================================

/** Clears the HTTP-only session cookie then navigates to login (full reload so middleware sees the cookie gone). */
export async function signOutAndGoToLogin(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
  } finally {
    window.location.assign("/login")
  }
}
