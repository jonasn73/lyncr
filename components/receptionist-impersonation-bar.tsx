"use client"

// Shown on /receptionist when an admin quick-switched via the dev sandbox.

import { useCallback, useEffect, useState } from "react"
import { KeyRound, Loader2 } from "lucide-react"
import { SANDBOX_IMPERSONATION_RETURN_PATH } from "@/lib/admin-impersonation"
import { Button } from "@/components/ui/button"

type ImpersonationState = {
  active: boolean
  return_to?: string | null
}

export function ReceptionistImpersonationBar() {
  const [impersonation, setImpersonation] = useState<ImpersonationState | null>(null)
  const [viewingEmail, setViewingEmail] = useState<string | null>(null)
  const [exiting, setExiting] = useState(false)

  const loadSession = useCallback(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        const imp = data?.data?.impersonation as ImpersonationState | undefined
        const email = data?.data?.user?.email as string | undefined
        setImpersonation(imp ?? { active: false })
        setViewingEmail(email ?? null)
      })
      .catch(() => setImpersonation({ active: false }))
  }, [])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  async function handleReturnToAdmin() {
    setExiting(true)
    try {
      const res = await fetch("/api/admin/impersonate/exit", {
        method: "POST",
        credentials: "include",
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; data?: { redirect?: string } }
      if (!res.ok) throw new Error(json.error || "Could not exit impersonation")
      window.location.href = json.data?.redirect ?? SANDBOX_IMPERSONATION_RETURN_PATH
    } catch {
      setExiting(false)
    }
  }

  if (!impersonation?.active) return null

  const fromSandbox = impersonation.return_to === SANDBOX_IMPERSONATION_RETURN_PATH

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-operator/40 bg-operator/90 px-4 py-3 text-sm text-operator"
    >
      <div className="flex min-w-0 items-center gap-2">
        <KeyRound className="h-4 w-4 shrink-0 text-operator" aria-hidden />
        <span>
          Admin sandbox session
          {viewingEmail ? (
            <>
              {" "}
              as <span className="font-semibold text-operator">{viewingEmail}</span>
            </>
          ) : null}
          {fromSandbox ? " — take the quiz, then simulate a call from the sandbox board." : "."}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={exiting}
        className="h-9 border-operator/50 bg-transparent text-operator hover:bg-operator/60 hover:text-operator-foreground"
        onClick={() => void handleReturnToAdmin()}
      >
        {exiting ? (
          <>
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
            Returning…
          </>
        ) : (
          "Return to Admin Sandbox"
        )}
      </Button>
    </div>
  )
}
