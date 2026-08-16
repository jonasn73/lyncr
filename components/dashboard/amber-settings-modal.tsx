"use client"

// Settings sheet — turn on Amber, verify personal mobile, save contact tip.

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { resolveBrowserTimezone } from "@/lib/telemetry-timezone"

type AmberStatus = {
  enabled: boolean
  amber_number: string | null
  owner_mobile_e164: string | null
  owner_mobile_verified: boolean
  /** Lyncr alert/dispatch phone — prefill before Amber verify. */
  suggested_mobile_e164?: string | null
  display_name: string
  promise: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AmberSettingsModal({ open, onOpenChange }: Props) {
  const { toast } = useToast()
  const { activeOrganizationId } = useDashboardWorkspace()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<AmberStatus | null>(null)
  const [mobile, setMobile] = useState("")
  const [code, setCode] = useState("")

  const orgQs =
    activeOrganizationId && !activeOrganizationId.startsWith("legacy-")
      ? `?organization_id=${encodeURIComponent(activeOrganizationId)}`
      : ""

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/amber${orgQs}`, { credentials: "include", cache: "no-store" })
      const json = (await res.json().catch(() => ({}))) as {
        data?: AmberStatus
        error?: string
      }
      if (!res.ok) {
        toast({
          title: "Amber unavailable",
          description: json.error || "Try again after the database update.",
          variant: "destructive",
        })
        setStatus(null)
        return
      }
      if (json.data) {
        setStatus(json.data)
        // Prefer already-verified Amber mobile; else Lyncr’s known alert phone.
        const prefill =
          json.data.owner_mobile_e164 || json.data.suggested_mobile_e164 || ""
        if (prefill) setMobile(prefill)
      }
    } finally {
      setLoading(false)
    }
  }, [orgQs, toast])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function post(action: string, extra?: Record<string, string>) {
    setBusy(true)
    try {
      const res = await fetch(`/api/amber${orgQs}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          organization_id: activeOrganizationId,
          timezone: resolveBrowserTimezone(),
          ...extra,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; data?: unknown }
      if (!res.ok) {
        toast({
          title: "Could not update Amber",
          description: json.error || "Try again.",
          variant: "destructive",
        })
        return false
      }
      await load()
      return true
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Amber · Lyncr</DialogTitle>
          <DialogDescription>
            Amber is your business assistant by text. Customers never see this number —
            they keep texting your normal business line.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
              <p className="text-xs font-semibold text-foreground">Status</p>
              <p className="mt-1 text-muted-foreground">
                {status?.enabled ? "On" : "Off"}
                {status?.amber_number
                  ? ` · ${formatPhoneDisplay(status.amber_number)}`
                  : ""}
              </p>
              {status?.owner_mobile_verified ? (
                <p className="mt-1 text-[11px] text-emerald-400">
                  Personal mobile verified
                  {status.owner_mobile_e164
                    ? ` · ${formatPhoneDisplay(status.owner_mobile_e164)}`
                    : ""}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-amber-400">
                  Verify your personal mobile before Amber will take commands.
                </p>
              )}
            </div>

            {!status?.enabled ? (
              <Button
                type="button"
                className="w-full"
                disabled={busy}
                onClick={async () => {
                  const ok = await post("enable")
                  if (ok) {
                    toast({
                      title: "Amber number ready",
                      description:
                        "This uses one business line slot + carrier credit. Next: verify your personal phone.",
                    })
                  }
                }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Turn on Amber (buy private number)"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={async () => {
                  const ok = await post("disable")
                  if (ok) toast({ title: "Amber paused" })
                }}
              >
                Turn Amber off
              </Button>
            )}

            {status?.enabled && status.amber_number ? (
              <div className="space-y-2 rounded-xl border border-border/60 px-3 py-2.5">
                <p className="text-xs font-semibold">Save this contact</p>
                <p className="text-[11px] text-muted-foreground">
                  On your phone, save {formatPhoneDisplay(status.amber_number)} as{" "}
                  <span className="font-semibold text-foreground">Amber · Lyncr</span>.
                </p>
              </div>
            ) : null}

            {status?.enabled ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold">Verify personal mobile</p>
                <p className="text-[11px] text-muted-foreground">
                  {status.suggested_mobile_e164 && !status.owner_mobile_verified
                    ? `We filled in your Lyncr alert phone (${formatPhoneDisplay(status.suggested_mobile_e164)}). Tap Text me a code once so Amber only obeys that number.`
                    : "We text a one-time code so only your phone can command Amber — not someone who finds the Amber number."}
                </p>
                <Input
                  inputMode="tel"
                  placeholder="+1…"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  disabled={busy}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={busy || !mobile.trim()}
                  onClick={async () => {
                    const ok = await post("verify_start", { mobile })
                    if (ok) {
                      toast({
                        title: "Code sent",
                        description: "Check your texts from Amber for the 6-digit code.",
                      })
                    }
                  }}
                >
                  Text me a code
                </Button>
                <Input
                  inputMode="numeric"
                  placeholder="6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={busy}
                />
                <Button
                  type="button"
                  className="w-full"
                  disabled={busy || !code.trim()}
                  onClick={async () => {
                    const ok = await post("verify_confirm", { mobile, code })
                    if (ok) {
                      setCode("")
                      toast({
                        title: "Phone verified",
                        description: "You can text Amber: BUSY, AVAILABLE, STATUS, HELP.",
                      })
                    }
                  }}
                >
                  Confirm code
                </Button>
              </div>
            ) : null}

            <p className="text-[11px] leading-snug text-muted-foreground">
              Phase 1: Amber can set Busy / Available (and Busy until a time). Customer reply
              drafts come later. Every customer text still uses your normal business number.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
