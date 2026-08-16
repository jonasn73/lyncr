"use client"

// Settings sheet — pick Amber number, auto-attach SMS campaign, verify personal mobile.

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
import { cn } from "@/lib/utils"

type AmberSmsView = {
  state: "ready" | "pending" | "not_assigned" | "no_campaign" | "failed" | "unknown"
  campaign_id: string | null
  workspace_campaign_ready: boolean
  label: string
  detail: string | null
}

type AmberStatus = {
  enabled: boolean
  amber_number: string | null
  owner_mobile_e164: string | null
  owner_mobile_verified: boolean
  suggested_mobile_e164?: string | null
  suggested_area_code?: string | null
  display_name: string
  promise: string
  sms?: AmberSmsView | null
}

type AvailableLine = { number: string; display: string }

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
  const [areaCode, setAreaCode] = useState("502")
  const [searching, setSearching] = useState(false)
  const [lines, setLines] = useState<AvailableLine[]>([])
  const [picked, setPicked] = useState<string | null>(null)

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
        const prefill =
          json.data.owner_mobile_e164 || json.data.suggested_mobile_e164 || ""
        if (prefill) setMobile(prefill)
        if (json.data.suggested_area_code) {
          setAreaCode(json.data.suggested_area_code)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [orgQs, toast])

  useEffect(() => {
    if (open) {
      setLines([])
      setPicked(null)
      void load()
    }
  }, [open, load])

  async function post(
    action: string,
    extra?: Record<string, string>
  ): Promise<{ ok: true; data?: Record<string, unknown> } | { ok: false }> {
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
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: Record<string, unknown>
      }
      if (!res.ok) {
        toast({
          title: "Could not update Amber",
          description: json.error || "Try again.",
          variant: "destructive",
        })
        return { ok: false }
      }
      await load()
      return { ok: true, data: json.data }
    } finally {
      setBusy(false)
    }
  }

  async function searchNumbers() {
    const ac = areaCode.replace(/\D/g, "").slice(0, 3)
    if (ac.length !== 3) {
      toast({
        title: "Enter a 3-digit area code",
        variant: "destructive",
      })
      return
    }
    setSearching(true)
    setPicked(null)
    try {
      const res = await fetch(
        `/api/numbers/telnyx?area_code=${encodeURIComponent(ac)}&type=local&page_size=12`,
        { credentials: "include" }
      )
      const data = (await res.json().catch(() => ({}))) as {
        numbers?: { number: string }[]
        error?: string
      }
      if (!res.ok) {
        toast({
          title: "Could not search numbers",
          description: data.error || "Try another area code.",
          variant: "destructive",
        })
        setLines([])
        return
      }
      const next = (data.numbers || [])
        .map((n) => String(n.number || "").trim())
        .filter(Boolean)
        .map((number) => ({ number, display: formatPhoneDisplay(number) }))
      setLines(next)
      if (next.length === 0) {
        toast({
          title: "No numbers in that area",
          description: "Try a nearby area code.",
        })
      }
    } finally {
      setSearching(false)
    }
  }

  const sms = status?.sms

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
              ) : status?.enabled ? (
                <p className="mt-1 text-[11px] text-amber-400">
                  Verify your personal mobile before Amber will take commands.
                </p>
              ) : null}
            </div>

            {!status?.enabled ? (
              <div className="space-y-3 rounded-xl border border-border/60 px-3 py-3">
                <p className="text-xs font-semibold">Pick Amber’s private number</p>
                <p className="text-[11px] text-muted-foreground">
                  Choose an area code, pick a number, then turn Amber on. Lyncr attaches it to
                  your SMS campaign automatically — you stay in this app.
                </p>
                <div className="flex gap-2">
                  <Input
                    inputMode="numeric"
                    placeholder="Area code"
                    value={areaCode}
                    onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
                    disabled={busy || searching}
                    className="w-24"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    disabled={busy || searching || areaCode.length !== 3}
                    onClick={() => void searchNumbers()}
                  >
                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find numbers"}
                  </Button>
                </div>
                {lines.length > 0 ? (
                  <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                    {lines.map((line) => (
                      <li key={line.number}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setPicked(line.number)}
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm tabular-nums transition-colors",
                            picked === line.number
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border/60 bg-background text-muted-foreground hover:border-border"
                          )}
                        >
                          <span>{line.display}</span>
                          {picked === line.number ? (
                            <span className="text-[10px] font-semibold uppercase text-primary">
                              Selected
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Button
                  type="button"
                  className="w-full"
                  disabled={busy || !picked}
                  onClick={async () => {
                    if (!picked) return
                    const result = await post("enable", { phone_number: picked })
                    if (result.ok) {
                      const smsState =
                        result.data?.sms &&
                        typeof result.data.sms === "object" &&
                        result.data.sms !== null &&
                        "state" in result.data.sms
                          ? String((result.data.sms as AmberSmsView).state)
                          : null
                      toast({
                        title: "Amber number ready",
                        description:
                          smsState === "pending"
                            ? "Number bought. SMS is activating on your campaign — verify codes still use your business line for now."
                            : "Uses one business line slot + carrier credit. Next: verify your personal phone.",
                      })
                    }
                  }}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Turn on Amber with this number"
                  )}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={async () => {
                  const result = await post("disable")
                  if (result.ok) toast({ title: "Amber paused" })
                }}
              >
                Turn Amber off
              </Button>
            )}

            {status?.enabled && status.amber_number ? (
              <div className="space-y-2 rounded-xl border border-border/60 px-3 py-2.5">
                <p className="text-xs font-semibold">SMS on your Lyncr campaign</p>
                <p
                  className={cn(
                    "text-[11px] font-medium",
                    sms?.state === "ready"
                      ? "text-emerald-400"
                      : sms?.state === "pending"
                        ? "text-amber-400"
                        : "text-muted-foreground"
                  )}
                >
                  {sms?.label || "Checking…"}
                </p>
                {sms?.detail ? (
                  <p className="text-[11px] text-muted-foreground">{sms.detail}</p>
                ) : null}
                {sms?.state === "no_campaign" ? (
                  <p className="text-[11px] text-muted-foreground">
                    Open Settings → Carrier / SMS registration if you still need to finish
                    approval. Everything stays in Lyncr.
                  </p>
                ) : null}
                {sms && sms.state !== "ready" && sms.state !== "no_campaign" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    disabled={busy}
                    onClick={async () => {
                      const result = await post("retry_sms_campaign")
                      if (result.ok) {
                        toast({
                          title: "SMS activation refreshed",
                          description: "Status updates below. Pending can take a little while.",
                        })
                      }
                    }}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Retry SMS activation"}
                  </Button>
                ) : null}
              </div>
            ) : null}

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
                    const result = await post("verify_start", { mobile })
                    if (result.ok) {
                      const usedFrom =
                        typeof result.data?.used_from === "string"
                          ? formatPhoneDisplay(result.data.used_from)
                          : null
                      toast({
                        title: "Code sent",
                        description: usedFrom
                          ? `Look for a text from ${usedFrom} (usually your business line). Enter the 6-digit code below.`
                          : "Check your texts — usually from your business line. Enter the 6-digit code below.",
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
                    const result = await post("verify_confirm", { mobile, code })
                    if (result.ok) {
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
